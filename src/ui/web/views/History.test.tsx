import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import { History } from "./History.tsx";

const summary = {
  aggregateUptime: 99.42,
  months: [
    { month: "2026-05", uptime: 99.9 },
    { month: "2026-06", uptime: null },
    { month: "2026-07", uptime: 98.2 },
    { month: "2026-08", uptime: 99.4 },
  ],
  providers: [
    {
      providerId: "github",
      buckets: [{ day: "2026-08-20", status: "operational" }],
      uptime7: 100,
      uptime30: 99.8,
      uptime90: 99.9,
      sampleCount: 400,
      incidentCount: 2,
      downtimeMinutes: 35,
    },
  ],
};

const fixtures = {
  history: summary,
  status: { providers: [providerFixture()], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
};

afterEach(() => vi.unstubAllGlobals());

describe("History", () => {
  it("shows aggregate uptime and month columns", async () => {
    renderWithProviders(<History />, fixtures);
    expect(await screen.findByText(/99[.,]42/)).toBeInTheDocument();
  });

  it("labels a month with no samples rather than drawing it as 0%", async () => {
    renderWithProviders(<History />, fixtures);
    expect(await screen.findByText(i18n.t("history.month-no-data"))).toBeInTheDocument();
  });

  it("offers 7, 30 and 90 day ranges", async () => {
    renderWithProviders(<History />, fixtures);
    for (const days of [7, 30, 90]) {
      // Compact "7d" on screen, spelled-out and translated as the accessible
      // name — assert the name an operator using a reader actually hears.
      const pill = await screen.findByRole("radio", { name: i18n.t("column.range", { days }) });
      expect(pill).toHaveTextContent(`${days}d`);
    }
  });

  it("re-requests the server on a range change instead of re-slicing loaded data", async () => {
    renderWithProviders(<History />, fixtures);
    await screen.findByText(/99[.,]42/);
    const before = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    // The pill reads "7d" but its accessible name is the spelled-out range.
    await userEvent.click(await screen.findByRole("radio", { name: i18n.t("column.range", { days: 7 }) }));
    const after = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(after).toBeGreaterThan(before);
    const requested = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(requested.some((url) => url.includes("days=7"))).toBe(true);
  });

  it("shows each provider's name and downtime figure", async () => {
    renderWithProviders(<History />, fixtures);
    expect(await screen.findByText("GitHub")).toBeInTheDocument();
    // history.downtime's real catalog template is "{minutes} min down" (a
    // numeric placeholder) — not the "{duration}" string the brief guessed.
    expect(await screen.findByText(i18n.t("history.downtime", { minutes: 35 }))).toBeInTheDocument();
  });
});

// Review Finding 5: providerFixture() defaults componentSelection to [], so
// ComponentRows never mounted anywhere above — none of this branch was
// covered. These give a provider an actual selection so it does.
describe("a provider's component breakdown (ComponentRows)", () => {
  const withSelection = (extra: { componentHistory?: unknown; errors?: Record<string, number> }) => ({
    history: summary,
    status: {
      providers: [
        providerFixture({
          componentSelection: [
            { id: "c1", name: "Component One" },
            { id: "c2", name: "Component Two" },
          ],
          // Only c1 has a live entry — c2 exercises the "no live status"
          // fallback to "unknown" on the same row.
          components: [{ id: "c1", name: "Component One", status: "degraded" }],
        }),
      ],
      pollIntervalMinutes: 5,
      lastPollAt: null,
      nextPollAt: null,
    },
    ...extra,
  });

  /**
   * The component's status dot, by the status it is drawing rather than by its
   * styling class. `[data-status]` is StatusDot's own semantic hook; the old
   * `.dot` query broke on any restyle that renamed the class and told you
   * nothing about what the dot meant.
   */
  const statusOfDot = (name: string): string | null => {
    const row = screen.getByText(name).closest("div");
    return row?.querySelector("[data-status]")?.getAttribute("data-status") ?? null;
  };

  it("marks a never-measured component and shows the live status dot, distinct from a measured one", async () => {
    renderWithProviders(
      <History />,
      withSelection({
        componentHistory: {
          provider: "github",
          days: 90,
          components: [
            {
              componentId: "c1",
              name: "Component One",
              buckets: [],
              uptime7: 100,
              uptime30: 100,
              uptime90: 100,
              sampleCount: 500,
            },
            {
              componentId: "c2",
              name: "Component Two",
              buckets: [],
              uptime7: 0,
              uptime30: 0,
              uptime90: 0,
              sampleCount: 0,
            },
          ],
        },
      }),
    );

    expect(await screen.findByText("Component One")).toBeInTheDocument();
    expect(await screen.findByText("Component Two")).toBeInTheDocument();
    // live: c1 has a current entry (degraded); c2 has none, falls back to "unknown".
    expect(statusOfDot("Component One")).toBe("degraded");
    expect(statusOfDot("Component Two")).toBe("unknown");
    // sampleCount === 0 reads as "never measured", not a bogus 0% — and only
    // on that one row, not on Component One's too.
    expect(screen.getAllByText(i18n.t("components.never-measured"))).toHaveLength(1);
  });

  it("says the breakdown is unsupported when it comes back with an empty component list", async () => {
    renderWithProviders(
      <History />,
      withSelection({ componentHistory: { provider: "github", days: 90, components: [] } }),
    );

    expect(await screen.findByText(i18n.t("components.rows-title"))).toBeInTheDocument();
    expect(await screen.findByText(i18n.t("components.unsupported"))).toBeInTheDocument();
    expect(screen.queryByText("Component One")).toBeNull();
  });

  it("keeps the rest of the view intact when only the component-history fetch fails", async () => {
    renderWithProviders(<History />, withSelection({ errors: { componentHistory: 500 } }));

    // The provider's own uptime figures, month columns and export row all sit
    // in the same React tree as ComponentRows. Before useComponentHistory got
    // `throwOnError: false` (review Finding 1), this 500 threw to the route's
    // errorElement and replaced every bit of that tree with ViewError — not
    // just this provider's component breakdown.
    expect(await screen.findByText(/99[.,]42/)).toBeInTheDocument();
    expect(await screen.findByText(i18n.t("history.month-no-data"))).toBeInTheDocument();
    expect(await screen.findByText("GitHub")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "GET /history?days=90" })).toBeInTheDocument();
    // Only this provider's component breakdown is missing — absent, not blanked.
    expect(screen.queryByText(i18n.t("components.rows-title"))).toBeNull();
    expect(screen.queryByText(/Could not load this view/)).toBeNull();
  });
});
