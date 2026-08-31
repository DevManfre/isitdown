import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders, sentence } from "@/test/harness.tsx";
import { History } from "./History.tsx";

const summary = {
  aggregateUptime: 99.42,
  dailyUptime: [
    { day: "2026-08-18", uptime: 99.9 },
    { day: "2026-08-19", uptime: null },
    { day: "2026-08-20", uptime: 98.2 },
  ],
  previousAggregate: 98.02,
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
      dailySeries: [
        { day: "2026-08-18", uptime: 100 },
        { day: "2026-08-19", uptime: null },
        { day: "2026-08-20", uptime: 99.8 },
      ],
      previousUptime: 97.1,
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

/**
 * A second provider, worse than GitHub over every window this view offers, so
 * the order the list puts them in is observable rather than incidental.
 */
const cloudflare = {
  providerId: "cloudflare",
  buckets: [{ day: "2026-08-20", status: "degraded" }],
  dailySeries: [
    { day: "2026-08-18", uptime: 80 },
    { day: "2026-08-19", uptime: 70 },
    { day: "2026-08-20", uptime: 75.33 },
  ],
  previousUptime: 85.1,
  uptime7: 100,
  uptime30: 78.09,
  uptime90: 75.33,
  sampleCount: 400,
  incidentCount: 63,
  downtimeMinutes: 8661,
};

const twoProviders = {
  ...fixtures,
  history: { ...summary, providers: [...summary.providers, cloudflare] },
  status: {
    providers: [
      providerFixture(),
      // A real component selection on this one, so "no component rows in the
      // list" is a statement about the list rather than about a provider that
      // had nothing to break down in the first place.
      providerFixture({
        id: "cloudflare",
        name: "Cloudflare",
        overallStatus: "degraded",
        componentSelection: [{ id: "fco", name: "Rome, Italy - (FCO)" }],
        components: [{ id: "fco", name: "Rome, Italy - (FCO)", status: "operational" }],
      }),
    ],
    pollIntervalMinutes: 5,
    lastPollAt: null,
    nextPollAt: null,
  },
};

/**
 * The drawer asks for `/history?days=90&provider=cloudflare`, which the harness
 * routes to the same `history` key as the summary — so this fixture answers per
 * request path: the provider's own history when one is named, the fleet summary
 * otherwise.
 */
const withDrawer = {
  ...twoProviders,
  history: (path: string) => (path.includes("provider=cloudflare") ? cloudflare : twoProviders.history),
  componentHistory: {
    provider: "cloudflare",
    days: 90,
    components: [
      {
        componentId: "fco",
        name: "Rome, Italy - (FCO)",
        buckets: [{ day: "2026-08-20", status: "operational" }],
        uptime7: 100,
        uptime30: 100,
        uptime90: 100,
        sampleCount: 90,
      },
    ],
  },
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
    expect(await screen.findByText("min down", { exact: false })).toHaveTextContent(
      sentence("history.downtime", { minutes: 35 }),
    );
  });

  it("states the delta against the previous window in percentage points", async () => {
    renderWithProviders(<History />, fixtures);

    // 99.42 - 98.02 = +1.40, rendered with the locale's own sign and separator.
    expect(await screen.findByText(/\+1[.,]4/)).toBeInTheDocument();
  });

  it("claims no delta when there is no previous window to compare against", async () => {
    renderWithProviders(<History />, {
      ...fixtures,
      history: {
        ...summary,
        previousAggregate: null,
        providers: summary.providers.map((provider) => ({ ...provider, previousUptime: null })),
      },
    });

    expect(await screen.findByText(/99[.,]42/)).toBeInTheDocument();
    expect(screen.queryByText(/pp/)).not.toBeInTheDocument();
  });

  it("spells out the active range beside the compact toggle", async () => {
    renderWithProviders(<History />, fixtures);

    expect(await screen.findByText(i18n.t("history.range-active", { days: 90 }))).toBeInTheDocument();
  });

  it("offers the history download as a labelled control, not as a raw URL", async () => {
    renderWithProviders(<History />, fixtures);

    expect(await screen.findByRole("button", { name: i18n.t("history.download", { days: 90 }) }))
      .toBeInTheDocument();
    expect(screen.queryByText(/GET \/history/)).not.toBeInTheDocument();
  });
});

// Review Finding 5: providerFixture() defaults componentSelection to [], so
// ComponentRows never mounted anywhere above — none of this branch was
// covered. These give a provider an actual selection so it does.
describe("a provider's component breakdown (ComponentRows)", () => {
  const withSelection = (extra: { componentHistory?: unknown; errors?: Record<string, number> }) => ({
    // The breakdown lives in the drawer now, and the drawer asks for
    // `/history?days=90&provider=github` — which the harness routes to this
    // same key as the summary. So the fixture answers per request path.
    history: (path: string) => (path.includes("provider=github") ? summary.providers[0] : summary),
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

  /**
   * The breakdown is one click away now, so every case here opens the drawer
   * first: that click is what mounts `ComponentRows` and fires its request at
   * all, which is the whole point of moving it off the list.
   */
  const openDrawer = async (): Promise<HTMLElement> => {
    await userEvent.click(
      await screen.findByRole("button", { name: i18n.t("history.open-detail", { name: "GitHub" }) }),
    );
    return screen.findByRole("dialog");
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
    await openDrawer();

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
    await openDrawer();

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
    expect(screen.getByRole("button", { name: i18n.t("history.download", { days: 90 }) })).toBeInTheDocument();

    // Asserted before the drawer opens on purpose: a modal sheet marks the rest
    // of the page `aria-hidden`, which takes it out of every `*ByRole` query.
    const drawer = await openDrawer();
    // Only this provider's component breakdown is missing — absent, not blanked.
    expect(within(drawer).queryByText(i18n.t("components.rows-title"))).toBeNull();
    expect(screen.queryByText(/Could not load this view/)).toBeNull();
  });
});

describe("the provider list", () => {
  it("orders providers worst first for the active range", async () => {
    renderWithProviders(<History />, twoProviders);

    const rows = await screen.findAllByRole("button", { name: /Cloudflare|GitHub/ });
    expect(rows[0]).toHaveAccessibleName(/Cloudflare/);
  });

  it("labels its columns instead of running five bare numbers together", async () => {
    renderWithProviders(<History />, twoProviders);

    expect(await screen.findByText(i18n.t("history.col-uptime", { days: 90 }))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("history.col-incidents"))).toBeInTheDocument();
  });

  it("shows one uptime figure per provider, for the active range only", async () => {
    renderWithProviders(<History />, twoProviders);

    expect(await screen.findByText(/75[.,]33/)).toBeInTheDocument();
    expect(screen.queryByText(/78[.,]09/)).not.toBeInTheDocument();
  });

  it("keeps component rows out of the list", async () => {
    renderWithProviders(<History />, twoProviders);

    await screen.findAllByRole("button", { name: /Cloudflare/ });
    expect(screen.queryByText(i18n.t("components.rows-title"))).not.toBeInTheDocument();
  });

  it("shows a compact delta on the row, not the full sentence the header already carries", async () => {
    renderWithProviders(<History />, twoProviders);

    const row = await screen.findByRole("button", { name: /Cloudflare/ });
    // -9.77 = 75.33 (uptime90) - 85.1 (previousUptime), rounded to 2dp.
    expect(within(row).getByText(i18n.t("history.delta-short", { value: "-9.77" }))).toBeInTheDocument();
    expect(within(row).queryByText(/vs previous/i)).not.toBeInTheDocument();
  });
});

describe("a provider's detail drawer", () => {
  const openCloudflare = async (): Promise<HTMLElement> => {
    await userEvent.click(await screen.findByRole("button", { name: /Cloudflare/ }));
    return screen.findByRole("dialog");
  };

  it("opens a provider's detail in a drawer, with the three windows under labels", async () => {
    renderWithProviders(<History />, withDrawer);

    const drawer = await openCloudflare();

    // The 30-day figure, absent from the list. `findByText` rather than
    // `toHaveTextContent`: the sheet mounts before its own per-provider
    // request lands, so the content has to be waited for, not sampled.
    expect(await within(drawer).findByText(/78[.,]09/)).toBeInTheDocument();
    expect(await within(drawer).findByText(i18n.t("components.rows-title"))).toBeInTheDocument();
  });

  it("gives the daily bars a colour legend they never had", async () => {
    renderWithProviders(<History />, withDrawer);

    const drawer = await openCloudflare();

    expect(await within(drawer).findByText(i18n.t("status.operational"))).toBeInTheDocument();
    expect(within(drawer).getByText(i18n.t("status.major-outage"))).toBeInTheDocument();
  });

  it("labels the daily bars by what they are, instead of repeating the window label above them", async () => {
    renderWithProviders(<History />, withDrawer);

    const drawer = await openCloudflare();

    expect(await within(drawer).findByText(i18n.t("history.drawer-bars"))).toBeInTheDocument();
    // The 90-day range `dt` above already reads "Last 90 days" — the bar
    // row's own heading must not repeat it verbatim, at the default range.
    expect(within(drawer).queryAllByText(i18n.t("column.range", { days: 90 }))).toHaveLength(1);
  });

  it("fires no per-provider request until a row is opened", async () => {
    renderWithProviders(<History />, withDrawer);
    await screen.findAllByRole("button", { name: /Cloudflare/ });

    const urls = () => (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(urls().some((url) => url.includes("provider=cloudflare"))).toBe(false);

    await openCloudflare();

    expect(urls().some((url) => url.includes("provider=cloudflare"))).toBe(true);
  });

  it("keeps the view standing when a provider's own history fails", async () => {
    renderWithProviders(<History />, {
      ...withDrawer,
      // The harness keys its `errors` fixture by category, and both `/history`
      // paths share the `history` key — so `errors: { history: 500 }` would fail
      // the summary too and prove nothing. Throwing from the fixture function
      // rejects only the request that named a provider.
      history: (path: string) => {
        if (path.includes("provider=")) throw new Error("provider history is down");
        return twoProviders.history;
      },
    });

    await userEvent.click(await screen.findByRole("button", { name: /Cloudflare/ }));

    // The headline, the month strip and the list are the summary query's, and
    // it succeeded. A drawer's own detail failing must not take them with it —
    // which is what the default `throwOnError` does to any query whose first
    // load fails in this tree.
    expect(await screen.findByText(/99[.,]42/)).toBeInTheDocument();
    expect(screen.getByText(i18n.t("history.month-no-data"))).toBeInTheDocument();
    // The list, by its column header and by the row of the provider that is
    // *not* open — "Cloudflare" itself now reads twice, once in the row and
    // once as the open sheet's title.
    expect(screen.getByText(i18n.t("history.col-uptime", { days: 90 }))).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.queryByText(/Could not load this view/)).toBeNull();
  });

  it("closes again without leaving the drawer behind", async () => {
    renderWithProviders(<History />, withDrawer);

    const drawer = await openCloudflare();
    await userEvent.click(within(drawer).getByRole("button", { name: i18n.t("action.close") }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
