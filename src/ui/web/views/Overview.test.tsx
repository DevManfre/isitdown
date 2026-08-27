import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders, sentence } from "@/test/harness.tsx";
import type { ProviderStatus } from "@/lib/types.ts";
import { Overview } from "./Overview.tsx";

const history = {
  aggregateUptime: 99.5,
  months: [],
  providers: [{ providerId: "github", buckets: [{ day: "2026-08-20", status: "operational" }] }],
};

afterEach(() => vi.unstubAllGlobals());

describe("Overview", () => {
  it("headlines all-operational when nothing is down", async () => {
    renderWithProviders(<Overview />, {
      status: { providers: [providerFixture()], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
      history,
    });
    expect(await screen.findByText(i18n.t("overview.title.all-operational"))).toBeInTheDocument();
  });

  it("uses the singular headline for exactly one provider down", async () => {
    renderWithProviders(<Overview />, {
      status: {
        providers: [providerFixture({ overallStatus: "major_outage" })],
        pollIntervalMinutes: 5,
        lastPollAt: null,
        nextPollAt: null,
      },
      history,
    });
    expect(await screen.findByText(i18n.t("overview.title.down", { count: 1 }))).toBeInTheDocument();
  });

  it("uses the plural headline for several", async () => {
    renderWithProviders(<Overview />, {
      status: {
        providers: [
          providerFixture({ overallStatus: "major_outage" }),
          providerFixture({ id: "cf", name: "Cloudflare", overallStatus: "degraded" }),
        ],
        pollIntervalMinutes: 5,
        lastPollAt: null,
        nextPollAt: null,
      },
      history,
    });
    // The count is a `NumberTicker`, so the headline is split across two
    // elements: match the tail, then read the whole line back off it.
    expect(await screen.findByText("providers are off the line.", { exact: false })).toHaveTextContent(
      sentence("overview.title.down", { count: 2 }),
    );
  });

  it("offers an incident-details action only when an incident is open", async () => {
    renderWithProviders(<Overview />, {
      status: { providers: [providerFixture()], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
      history,
    });
    await screen.findByText(i18n.t("overview.title.all-operational"));
    expect(screen.queryByRole("button", { name: i18n.t("action.incident-details") })).toBeNull();
  });

  it("links the incident-details action to the provider's first active incident", async () => {
    renderWithProviders(<Overview />, {
      status: {
        providers: [
          providerFixture({
            overallStatus: "major_outage",
            activeIncidents: [
              { id: "i1", name: "Outage", impact: "major", status: "investigating", updatedAt: "2026-08-21T00:00:00Z" },
              { id: "i2", name: "Second", impact: "minor", status: "investigating", updatedAt: "2026-08-21T00:00:00Z" },
            ],
          }),
        ],
        pollIntervalMinutes: 5,
        lastPollAt: null,
        nextPollAt: null,
      },
      history,
    });
    const button = await screen.findByRole("button", { name: i18n.t("action.incident-details") });
    await button.click();
    expect(window.location.hash).toBe("#/incidents/github/i1");
  });

  it("shows the empty state when no provider is configured", async () => {
    renderWithProviders(<Overview />, {
      status: { providers: [], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
      history: { aggregateUptime: 0, months: [], providers: [] },
    });
    expect(await screen.findByText(i18n.t("providers.empty"))).toBeInTheDocument();
  });

  // No test in this suite otherwise asserts rendered copy against anything
  // but t() itself, which passes even when a template's placeholders go
  // unfilled. This pins the actual characters an operator reads.
  it("renders the literal 90-day uptime footer, not a raw placeholder", async () => {
    renderWithProviders(<Overview />, {
      status: { providers: [providerFixture({ uptime90: 99.9 })], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
      history,
    });
    expect(await screen.findByText("· 90d", { exact: false })).toHaveTextContent("99.90% · 90d");
  });

  // Regression for the review finding: on an initial-load failure, `status`
  // stayed undefined and `providers` fell back to `[]`, so this view used to
  // render "all operational" over a load failure instead of the error
  // boundary. `errors: { status: 500 }` makes the /status fetch fail with
  // nothing to show yet, so `throwOnError` (lib/queryClient.ts) must throw
  // and the harness's `ViewError` route must render `error.load-failed`
  // instead of any provider copy.
  it("shows the load-failed message instead of 'all operational' when /status fails", async () => {
    renderWithProviders(<Overview />, {
      status: { providers: [], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
      history,
      errors: { status: 500 },
    });
    expect(await screen.findByText(i18n.t("error.load-failed", { error: "HTTP 500" }))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("overview.title.all-operational"))).toBeNull();
  });
});

/**
 * How the fleet is drawn changes at two counts (see lib/overviewShape.ts).
 * What these pin is the space claim behind that: past six providers the rings
 * shrink and leave the hero, and past fourteen they stop being drawn at all —
 * which is the whole reason the hero's height stops tracking the fleet.
 */
describe("Overview's fleet shapes", () => {
  const statusOf = (providers: ProviderStatus[]) => ({
    providers,
    pollIntervalMinutes: 5,
    lastPollAt: null,
    nextPollAt: null,
  });

  /** A fleet of `count`, whose first provider is the one in trouble. */
  const fleet = (count: number): ProviderStatus[] =>
    Array.from({ length: count }, (_, i) =>
      providerFixture({
        id: `p${i}`,
        name: `Provider ${i}`,
        ...(i === 0 ? { overallStatus: "major_outage" as const } : {}),
      }),
    );

  const rings = () => document.querySelectorAll('[data-slot="uptime-ring"]');
  /** The ring's own box, which `size` writes inline — the pixel claim itself. */
  const ringBox = () => rings()[0]?.querySelector("div")?.getAttribute("style") ?? "";

  it("draws an 80px ring per provider while the fleet fits beside the copy", async () => {
    renderWithProviders(<Overview />, { status: statusOf(fleet(6)), history });
    // Two matches per name while the rings are drawn — the ring's label and
    // the row's, as the other suites' `findAllByText` already accounts for.
    await screen.findAllByText("Provider 1");
    expect(rings()).toHaveLength(6);
    expect(ringBox()).toContain("width: 80px");
    expect(screen.queryByText(i18n.t("overview.group.operational"))).toBeNull();
  });

  it("keeps every ring but halves it into the band past six providers", async () => {
    renderWithProviders(<Overview />, { status: statusOf(fleet(10)), history });
    await screen.findAllByText("Provider 1");
    expect(rings()).toHaveLength(10);
    expect(ringBox()).toContain("width: 56px");
  });

  it("stops drawing rings past fourteen and shows the aggregate figure instead", async () => {
    renderWithProviders(<Overview />, { status: statusOf(fleet(15)), history });
    await screen.findByText(i18n.t("overview.group.operational"));
    expect(rings()).toHaveLength(0);
    expect(document.querySelector('[data-slot="fleet-summary"]')).not.toBeNull();
    expect(screen.getByText(i18n.t("overview.summary.window"))).toBeInTheDocument();
  });

  it("opens the group of providers in trouble and leaves the operational one shut", async () => {
    renderWithProviders(<Overview />, { status: statusOf(fleet(15)), history });
    await screen.findByText(i18n.t("overview.group.problems"));
    // The one provider in trouble is drawn as a row; the fourteen healthy ones
    // are a strip of dots, so none of their names is on the page yet.
    expect(screen.getByText("Provider 0")).toBeInTheDocument();
    expect(screen.queryByText("Provider 7")).toBeNull();
  });

  it("reveals the operational rows when its group is opened", async () => {
    renderWithProviders(<Overview />, { status: statusOf(fleet(15)), history });
    const trigger = await screen.findByRole("button", {
      name: new RegExp(i18n.t("overview.group.operational")),
    });
    await trigger.click();
    expect(await screen.findByText("Provider 7")).toBeInTheDocument();
  });
});

/**
 * A disabled provider is one the poller has been told to skip (poller.ts:164),
 * so nothing about it is being measured any more. This view therefore leaves it
 * out entirely rather than drawing a stale ring and folding an unmeasured
 * figure into the fleet's average.
 */
describe("Overview with a disabled provider", () => {
  const statusOf = (providers: ProviderStatus[]) => ({
    providers,
    pollIntervalMinutes: 5,
    lastPollAt: null,
    nextPollAt: null,
  });

  it("draws neither a ring nor a row for it", async () => {
    renderWithProviders(<Overview />, {
      status: statusOf([
        providerFixture(),
        providerFixture({ id: "cf", name: "Cloudflare", enabled: false }),
      ]),
      history,
    });
    await screen.findAllByText("GitHub");
    expect(screen.queryByText("Cloudflare")).toBeNull();
    expect(document.querySelectorAll('[data-slot="uptime-ring"]')).toHaveLength(1);
  });

  it("keeps its uptime out of the fleet average", async () => {
    renderWithProviders(<Overview />, {
      status: statusOf([
        providerFixture({ uptime90: 99.9 }),
        providerFixture({ id: "cf", name: "Cloudflare", enabled: false, uptime90: 50 }),
      ]),
      history,
    });
    // 99.90%, not the 74.95% an unmeasured provider would drag it to.
    expect(await screen.findByText("· 90d", { exact: false })).toHaveTextContent("99.90% · 90d");
  });

  it("keeps its status out of the headline, so a disabled provider is not 'off the line'", async () => {
    renderWithProviders(<Overview />, {
      status: statusOf([
        providerFixture(),
        providerFixture({ id: "cf", name: "Cloudflare", enabled: false, overallStatus: "major_outage" }),
      ]),
      history,
    });
    // Waiting for the provider name first is load-bearing: before /status
    // answers, `providers` is empty and the headline already reads
    // all-operational, so a bare findByText here passes on the loading state
    // and would never have caught the disabled provider being counted.
    await screen.findAllByText("GitHub");
    expect(screen.getByText(i18n.t("overview.title.all-operational"))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("overview.title.down", { count: 1 }))).toBeNull();
  });

  it("says the fleet is disabled, not that nothing is configured, when every provider is off", async () => {
    renderWithProviders(<Overview />, {
      status: statusOf([providerFixture({ enabled: false })]),
      history,
    });
    expect(await screen.findByText(i18n.t("overview.all-disabled"))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("providers.empty"))).toBeNull();
  });
});

/**
 * The hero's beacon: one colour and one shape for the whole estate, chosen by
 * the worst provider present — the same verdict the headline beside it gives
 * in words, for an operator who only glances.
 */
describe("Overview's status beacon", () => {
  const tier = () => screen.getByTestId("status-beacon").getAttribute("data-tier");

  it("is ok when every provider is operational", async () => {
    renderWithProviders(<Overview />, {
      status: { providers: [providerFixture()], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
      history,
    });
    // The provider name only renders once the status query has answered; the
    // beacon itself is on screen from the first paint, reading "unknown"
    // because nothing has been measured yet.
    await screen.findAllByText("GitHub");
    expect(tier()).toBe("ok");
  });

  it("warns for a degraded provider rather than going straight to danger", async () => {
    renderWithProviders(<Overview />, {
      status: {
        providers: [providerFixture(), providerFixture({ id: "cf", name: "Cloudflare", overallStatus: "degraded" })],
        pollIntervalMinutes: 5,
        lastPollAt: null,
        nextPollAt: null,
      },
      history,
    });
    // The provider name only renders once the status query has answered; the
    // beacon itself is on screen from the first paint, reading "unknown"
    // because nothing has been measured yet.
    await screen.findAllByText("GitHub");
    expect(tier()).toBe("warn");
  });

  it("takes the worst provider, not the most common one", async () => {
    renderWithProviders(<Overview />, {
      status: {
        providers: [
          providerFixture(),
          providerFixture({ id: "cf", name: "Cloudflare", overallStatus: "degraded" }),
          providerFixture({ id: "an", name: "Anthropic", overallStatus: "major_outage" }),
        ],
        pollIntervalMinutes: 5,
        lastPollAt: null,
        nextPollAt: null,
      },
      history,
    });
    // The provider name only renders once the status query has answered; the
    // beacon itself is on screen from the first paint, reading "unknown"
    // because nothing has been measured yet.
    await screen.findAllByText("GitHub");
    expect(tier()).toBe("danger");
  });
});
