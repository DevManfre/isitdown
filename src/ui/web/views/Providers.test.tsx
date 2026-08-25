import { screen, within } from "@testing-library/react";
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
    expect(screen.queryByText("GitHub")).toBeNull();
    expect(screen.queryByText("Cloudflare")).toBeNull();
    expect(await screen.findByText("Discord")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: i18n.t("filter.issues") })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: i18n.t("filter.all") })).toHaveAttribute("aria-pressed", "false");
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
});
