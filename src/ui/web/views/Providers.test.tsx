import { screen, waitForElementToBeRemoved, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import { Providers } from "./Providers.tsx";

const status = {
  providers: [
    providerFixture(),
    providerFixture({ id: "cf", name: "Cloudflare", enabled: false }),
    providerFixture({ id: "discord", name: "Discord", overallStatus: "major_outage" }),
  ],
  pollIntervalMinutes: 5,
  lastPollAt: null,
  nextPollAt: null,
};
const history = {
  aggregateUptime: 99,
  months: [],
  providers: [{ providerId: "github", buckets: [], uptime90: 99.9, incidentCount: 2 }],
};

// Every fixture provider shares one baseUrl, so the host line the provider
// cell renders beneath the name strips back out of the cell's text.
const HOST = "www.githubstatus.com";

/** The provider names in the order the table renders them, top row first. */
const renderedOrder = (): string[] =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => (within(row).getAllByRole("cell")[0]?.textContent ?? "").replace(HOST, ""));

/** Clicks a column header, which is the data table's sort control. */
const sortBy = (user: ReturnType<typeof userEvent.setup>, columnKey: string) =>
  user.click(screen.getByRole("button", { name: i18n.t(columnKey) }));

afterEach(() => vi.unstubAllGlobals());

describe("Providers", () => {
  it("renders one row per configured provider", async () => {
    renderWithProviders(<Providers />, { status, history });
    expect(await screen.findByText("GitHub")).toBeInTheDocument();
    expect(await screen.findByText("Cloudflare")).toBeInTheDocument();
  });

  it("is read-only: no edit or remove control lives here", async () => {
    renderWithProviders(<Providers />, { status, history });
    await screen.findByText("GitHub");
    expect(screen.queryByRole("button", { name: i18n.t("action.edit") })).toBeNull();
    expect(screen.queryByRole("button", { name: i18n.t("action.remove") })).toBeNull();
  });

  it("labels every column from the catalog", async () => {
    renderWithProviders(<Providers />, { status, history });
    for (const key of ["column.provider", "column.adapter", "column.status", "column.uptime", "column.incidents"]) {
      expect(await screen.findByText(i18n.t(key))).toBeInTheDocument();
    }
  });

  it("shows the empty state with no providers", async () => {
    renderWithProviders(<Providers />, {
      status: { providers: [], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
      history: { aggregateUptime: 0, months: [], providers: [] },
    });
    expect(await screen.findByText(i18n.t("providers.empty"))).toBeInTheDocument();
  });

  it("dims a disabled provider while still listing it", async () => {
    renderWithProviders(<Providers />, { status, history });
    const cloudflare = await screen.findByText("Cloudflare");
    const row = cloudflare.closest("tr");
    expect(row).not.toBeNull();
    expect(row).toHaveClass("opacity-55");
  });

  // No test above asserts rendered copy against anything but t() itself,
  // which passes whether or not a template's placeholders were satisfied.
  // This pins the actual uptime percentage text an operator reads, using a
  // value distinct from the provider fixture's own uptime90 (99.9) so a pass
  // proves the cell reads history's uptime90, not the status one.
  it("renders the literal uptime percentage from history, not the status uptime90", async () => {
    renderWithProviders(<Providers />, {
      status: { providers: [providerFixture()], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
      history: {
        aggregateUptime: 87.65,
        months: [],
        providers: [{ providerId: "github", buckets: [], uptime90: 87.65, incidentCount: 0 }],
      },
    });
    expect(await screen.findByText("87.65%")).toBeInTheDocument();
  });

  // providers.js:113 staggers each row with stagger(index, 60) — 60ms apart,
  // not 45. Pinned literally so a regression on the delay value is caught,
  // not just "some animation exists".
  it("staggers table rows 60ms apart, matching providers.js's stagger(index, 60)", async () => {
    renderWithProviders(<Providers />, { status, history });
    const first = (await screen.findByText("GitHub")).closest("tr");
    const second = (await screen.findByText("Cloudflare")).closest("tr");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).toHaveStyle({ animationDelay: "0ms" });
    expect(second).toHaveStyle({ animationDelay: "60ms" });
  });

  // providers.js:119-123 renders hostOf(provider.baseUrl) as a muted mono
  // line beneath the provider name. The design prototype carries the same
  // field ({{ p.host }}).
  it("shows the provider's host beneath its name, matching providers.js's hostOf()", async () => {
    renderWithProviders(<Providers />, { status, history });
    const row = (await screen.findByText("GitHub")).closest("tr");
    if (row === null) throw new Error("expected a table row");
    expect(within(row).getByText("www.githubstatus.com")).toBeInTheDocument();
  });

  // providers.js:73-97 (headerRow) renders a seg-pills toggle beside the
  // intro line. Catalog keys filter.all / filter.issues already exist.
  it("renders the all/issues filter defaulting to all", async () => {
    renderWithProviders(<Providers />, { status, history });
    const allButton = await screen.findByRole("button", { name: i18n.t("filter.all") });
    const issuesButton = await screen.findByRole("button", { name: i18n.t("filter.issues") });
    expect(allButton).toHaveAttribute("aria-pressed", "true");
    expect(issuesButton).toHaveAttribute("aria-pressed", "false");
  });

  it("filters to providers with an open issue when 'issues' is selected", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Providers />, { status, history });
    await screen.findByText("GitHub");
    await user.click(screen.getByRole("button", { name: i18n.t("filter.issues") }));
    // The dropped rows animate out first (see below), so they leave the DOM a
    // beat later rather than on the click itself.
    await waitForElementToBeRemoved(() => screen.queryByText("GitHub"));
    expect(screen.queryByText("Cloudflare")).toBeNull();
    expect(await screen.findByText("Discord")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: i18n.t("filter.issues") })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: i18n.t("filter.all") })).toHaveAttribute("aria-pressed", "false");
  });

  // The entry animation was one-sided: rows rose in on a filter change and
  // blinked out of existence on the way back. A dropped row keeps its slot,
  // and its class, for exactly as long as `.anim-sink` needs.
  it("animates a dropped row out instead of unmounting it on the spot", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Providers />, { status, history });
    await screen.findByText("GitHub");
    await user.click(screen.getByRole("button", { name: i18n.t("filter.issues") }));

    const leaving = screen.getByText("GitHub").closest("tr");
    if (leaving === null) throw new Error("expected the dropped provider to still have a row");
    expect(leaving).toHaveClass("anim-sink");
    expect(leaving).not.toHaveClass("anim-rise");
    // No stagger on the way out: every dropped row goes at once.
    expect(leaving).toHaveStyle({ animationDelay: "0ms" });

    await waitForElementToBeRemoved(() => screen.queryByText("GitHub"));
  });

  // Coming back to "all" must not leave the outgoing rows stuck mid-fade: the
  // rows that were leaving are the very rows arriving again.
  it("clears the leaving rows when the filter widens again", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Providers />, { status, history });
    await screen.findByText("GitHub");
    await user.click(screen.getByRole("button", { name: i18n.t("filter.issues") }));
    await user.click(screen.getByRole("button", { name: i18n.t("filter.all") }));

    const row = (await screen.findByText("GitHub")).closest("tr");
    expect(row).toHaveClass("anim-rise");
    expect(row).not.toHaveClass("anim-sink");
  });

  // providers.js:86 — "if (showIssuesOnly === issuesOnly) return" — clicking
  // the already-active option changes nothing.
  it("clicking the already-active filter option is a no-op", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Providers />, { status, history });
    const allButton = await screen.findByRole("button", { name: i18n.t("filter.all") });
    await user.click(allButton);
    expect(allButton).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("GitHub")).toBeInTheDocument();
    expect(await screen.findByText("Discord")).toBeInTheDocument();
  });

  // Regression for the review finding: on an initial-load failure this view
  // used to fall back to providers.empty ("nothing configured"), which is
  // just as false as Overview's "all operational". errors: { status: 500 }
  // makes /status fail with nothing to show yet.
  it("shows the load-failed message instead of the empty state when /status fails", async () => {
    renderWithProviders(<Providers />, {
      status: { providers: [], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
      history,
      errors: { status: 500 },
    });
    expect(await screen.findByText(i18n.t("error.load-failed", { error: "HTTP 500" }))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("providers.empty"))).toBeNull();
  });

  // The table is a TanStack (shadcn data-table) instance, so every column
  // header is a sort control: clicking one re-orders the rows client-side.
  // These pin the order an operator reads, not the sorting state object.
  describe("sorting", () => {
    it("sorts by provider name, reverses, then returns to the configured order", async () => {
      const user = userEvent.setup();
      renderWithProviders(<Providers />, { status, history });
      await screen.findByText("GitHub");
      expect(renderedOrder()).toEqual(["GitHub", "Cloudflare", "Discord"]);

      await sortBy(user, "column.provider");
      expect(renderedOrder()).toEqual(["Cloudflare", "Discord", "GitHub"]);

      await sortBy(user, "column.provider");
      expect(renderedOrder()).toEqual(["GitHub", "Discord", "Cloudflare"]);

      // Third click drops the sort rather than cycling back to ascending, so
      // the configured order stays reachable.
      await sortBy(user, "column.provider");
      expect(renderedOrder()).toEqual(["GitHub", "Cloudflare", "Discord"]);
    });

    // Status has to sort by how bad it is, not by its label: alphabetically
    // "Degraded" leads and "Operational" trails, which would read as an
    // ordering by severity while being nothing of the sort.
    it("sorts the status column worst-first, by severity and not by label", async () => {
      const user = userEvent.setup();
      renderWithProviders(<Providers />, {
        status: {
          providers: [
            providerFixture({ id: "github", name: "GitHub" }),
            providerFixture({ id: "cf", name: "Cloudflare", overallStatus: "degraded" }),
            providerFixture({ id: "discord", name: "Discord", overallStatus: "major_outage" }),
          ],
          pollIntervalMinutes: 5,
          lastPollAt: null,
          nextPollAt: null,
        },
        history,
      });
      await screen.findByText("GitHub");

      await sortBy(user, "column.status");
      expect(renderedOrder()).toEqual(["Discord", "Cloudflare", "GitHub"]);

      await sortBy(user, "column.status");
      expect(renderedOrder()).toEqual(["GitHub", "Cloudflare", "Discord"]);
    });

    // "100" sorts before "9.5" as text; the column is a number.
    it("sorts uptime numerically, not as text", async () => {
      const user = userEvent.setup();
      renderWithProviders(<Providers />, {
        status: {
          providers: [
            providerFixture({ id: "github", name: "GitHub" }),
            providerFixture({ id: "cf", name: "Cloudflare" }),
            providerFixture({ id: "discord", name: "Discord" }),
          ],
          pollIntervalMinutes: 5,
          lastPollAt: null,
          nextPollAt: null,
        },
        history: {
          aggregateUptime: 70,
          months: [],
          providers: [
            { providerId: "github", buckets: [], uptime90: 100, incidentCount: 0 },
            { providerId: "cf", buckets: [], uptime90: 9.5, incidentCount: 0 },
            { providerId: "discord", buckets: [], uptime90: 99.9, incidentCount: 0 },
          ],
        },
      });
      await screen.findByText("GitHub");

      // Worst uptime first: that is the row an operator is looking for.
      await sortBy(user, "column.uptime");
      expect(renderedOrder()).toEqual(["Cloudflare", "Discord", "GitHub"]);

      await sortBy(user, "column.uptime");
      expect(renderedOrder()).toEqual(["GitHub", "Discord", "Cloudflare"]);
    });

    it("sorts by incident count, busiest provider first", async () => {
      const user = userEvent.setup();
      renderWithProviders(<Providers />, { status, history });
      await screen.findByText("GitHub");

      // Only GitHub has incidents in the history fixture (2).
      await sortBy(user, "column.incidents");
      expect(renderedOrder()[0]).toBe("GitHub");
    });

    it("sorts by adapter", async () => {
      const user = userEvent.setup();
      renderWithProviders(<Providers />, {
        status: {
          providers: [
            providerFixture({ id: "github", name: "GitHub", adapter: "statuspage" }),
            providerFixture({ id: "cf", name: "Cloudflare", adapter: "atlassian" }),
          ],
          pollIntervalMinutes: 5,
          lastPollAt: null,
          nextPollAt: null,
        },
        history,
      });
      await screen.findByText("GitHub");

      await sortBy(user, "column.adapter");
      expect(renderedOrder()).toEqual(["Cloudflare", "GitHub"]);
    });

    // Sort state has to reach a screen reader too, and `aria-sort` on the
    // header cell is what carries it.
    it("reports the sorted column and its direction with aria-sort", async () => {
      const user = userEvent.setup();
      renderWithProviders(<Providers />, { status, history });
      await screen.findByText("GitHub");
      const header = () => screen.getByRole("button", { name: i18n.t("column.provider") }).closest("th");

      expect(header()).toHaveAttribute("aria-sort", "none");
      await sortBy(user, "column.provider");
      expect(header()).toHaveAttribute("aria-sort", "ascending");
      await sortBy(user, "column.provider");
      expect(header()).toHaveAttribute("aria-sort", "descending");
    });
  });
});
