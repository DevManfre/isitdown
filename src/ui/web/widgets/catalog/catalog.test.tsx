import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import { DashboardGrid } from "@/components/DashboardGrid.tsx";
import type { DashboardLayout, WidgetConfig } from "../../../dashboardLayout.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const t = (key: string, values: Record<string, unknown> = {}) => i18n.t(key, values);
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const ahead = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const none = { groups: [], providers: [] };

const status = {
  providers: [
    providerFixture({ id: "github", name: "GitHub", uptime90: 99.9 }),
    providerFixture({ id: "cloudflare", name: "Cloudflare", overallStatus: "major_outage", uptime90: 99.5 }),
    providerFixture({ id: "stripe", name: "Stripe", uptime90: 99.99 }),
  ],
  groups: [{ id: "pay", providers: ["stripe"], status: "operational", affected: [] }],
  pollIntervalMinutes: 5,
  lastPollAt: null,
  nextPollAt: null,
};
const history = { aggregateUptime: 99.5, dailyUptime: [], months: [], providers: [] };

function show(widget: WidgetConfig, fixtures: Record<string, unknown> = {}) {
  const layout: DashboardLayout = { version: 1, widgets: [widget] };
  return renderWithProviders(<DashboardGrid layout={layout} />, { status, history, ...fixtures });
}

const incident = (providerId: string, impact: string, startedMinutesAgo: number, name: string) => ({
  providerId,
  incidentId: `${providerId}-1`,
  name,
  impact,
  status: "investigating",
  startedAt: iso(startedMinutesAgo),
  updatedAt: iso(2),
  resolvedAt: null,
});
const incidents = (active: unknown[], resolved: unknown[] = []) => (path: string) => ({
  active,
  page: { items: path.includes("state=resolved") ? resolved : [...active, ...resolved], page: 1, pageSize: 100, total: 1 },
  counts: { all: 0, active: active.length, resolved: resolved.length },
});

describe("catalogue widgets", () => {
  it("open incidents: worst first, and a quiet fleet says when the last one closed", async () => {
    show(
      { id: "w", type: "open-incidents", width: "full", props: { filter: none } },
      { incidents: incidents([incident("github", "minor", 12, "Slow pushes"), incident("cloudflare", "critical", 38, "Workers down")]) },
    );
    const titles = await screen.findAllByText(/Workers down|Slow pushes/);
    expect(titles[0]?.textContent).toContain("Workers down");
    expect(screen.getAllByText(t("widget.open-incidents.meta", { count: 2, age: "38 min" })).length).toBeGreaterThan(0);
  });

  it("open incidents: says so — with the last closed one — when nothing is open", async () => {
    const closed = { ...incident("stripe", "minor", 3000, "Blip"), resolvedAt: iso(2880) };
    show({ id: "w", type: "open-incidents", width: "half", props: { filter: none } }, { incidents: incidents([], [closed]) });
    expect(await screen.findByText(new RegExp(t("widget.open-incidents.none-since", { provider: "Stripe", since: "" }).slice(0, 20)))).toBeInTheDocument();
  });

  it("open incidents: a slice with nothing open still says the fleet has some", async () => {
    show(
      { id: "w", type: "open-incidents", width: "half", props: { filter: { groups: ["pay"], providers: [] } } },
      { incidents: incidents([incident("cloudflare", "critical", 10, "Down")]) },
    );
    expect(await screen.findByText(t("widget.open-incidents.none-here", { count: 1 }))).toBeInTheDocument();
  });

  it("maintenances: the one in progress first, then what is coming", async () => {
    show(
      { id: "w", type: "maintenances", width: "half", props: { filter: none } },
      {
        maintenances: {
          maintenances: [
            { id: "m2", providerId: "stripe", name: "Dashboard", status: "scheduled", startsAt: ahead(1500), endsAt: ahead(1620), componentIds: [] },
            { id: "m1", providerId: "github", name: "Packages", status: "in_progress", startsAt: iso(30), endsAt: ahead(45), componentIds: [] },
            { id: "m0", providerId: "github", name: "Long gone", status: "completed", startsAt: iso(3000), endsAt: iso(2900), componentIds: [] },
          ],
        },
      },
    );
    expect((await screen.findAllByText("GitHub · Packages")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Stripe · Dashboard").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Long gone/)).toBeNull();
    expect(screen.getAllByText(t("widget.maintenances.live-tag")).length).toBeGreaterThan(0);
  });

  it("maintenances: an empty fortnight is said in words", async () => {
    show({ id: "w", type: "maintenances", width: "full", props: { filter: none } }, { maintenances: { maintenances: [] } });
    expect(await screen.findByText(t("widget.maintenances.none", { days: 14 }))).toBeInTheDocument();
  });

  const budget = (providerId: string, spent: number, willMiss: boolean) => ({
    providerId, month: "2026-10", target: 99.9, uptime: 99.9, budgetMinutes: 43, spentMinutes: spent, remainingMinutes: 43 - spent,
    burnRate: null, projectedUptime: null, willMiss, elapsedMinutes: 31_680, monthMinutes: 44_640, measuredMinutes: 31_680,
  });

  it("error budget: names the one over its allowance first", async () => {
    show(
      { id: "w", type: "error-budget", width: "full", props: { filter: none } },
      { sla: { month: "2026-10", providers: [budget("stripe", 5, false), budget("cloudflare", 60, true)] } },
    );
    expect(await screen.findByText(t("widget.error-budget.over", { provider: "Cloudflare", spent: "1 hr", budget: "43 min" }).slice(0, 25), { exact: false })).toBeInTheDocument();
  });

  it("error budget: without a target, points at where to set one", async () => {
    show({ id: "w", type: "error-budget", width: "third", props: { filter: none } });
    expect(await screen.findByText(t("widget.error-budget.none"))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: t("widget.error-budget.set-target") })).toBeInTheDocument();
  });

  it("provider tile: left on its default, follows the worst of the fleet", async () => {
    show({ id: "w", type: "provider-tile", width: "full", props: { provider: null } });
    expect(await screen.findByText("Cloudflare")).toBeInTheDocument();
    expect(screen.getByText(t("widget.provider-tile.worst"))).toBeInTheDocument();
  });

  it("provider tile: shows the one it names, and says when that one is gone", async () => {
    const { unmount } = show({ id: "w", type: "provider-tile", width: "full", props: { provider: "stripe" } });
    expect(await screen.findByText("Stripe")).toBeInTheDocument();
    unmount();
    show({ id: "w", type: "provider-tile", width: "full", props: { provider: "heroku" } });
    expect(await screen.findByText(t("widget.provider-tile.missing", { provider: "heroku" }))).toBeInTheDocument();
  });

  it("sparklines: says who is getting worse than the month before", async () => {
    const day = (i: number, uptime: number) => ({ day: `2026-08-${String((i % 28) + 1).padStart(2, "0")}`, uptime });
    const series = (before: number, after: number) => [
      ...Array.from({ length: 30 }, (_, i) => day(i, before)),
      ...Array.from({ length: 30 }, (_, i) => day(i, after)),
    ];
    const provider = (providerId: string, before: number, after: number) => ({
      providerId, buckets: [], uptime7: after, uptime30: after, uptime90: after, sampleCount: 1, incidentCount: 0, downtimeMinutes: 0,
      dailySeries: series(before, after), previousUptime: null, dailyCoverage: [], coverage: null, detectionDelay: null,
    });
    show(
      { id: "w", type: "sparklines", width: "full", props: { filter: none } },
      { history: { ...history, providers: [provider("cloudflare", 99.9, 99.4), provider("github", 99.9, 99.95)] } },
    );
    expect(await screen.findByText(t("widget.sparklines.falling", { count: 1, provider: "Cloudflare", delta: "−0.50" }))).toBeInTheDocument();
  });

  it("year calendar: counts the days with trouble, and waits for two weeks of record", async () => {
    const cells = Array.from({ length: 60 }, (_, i) => ({
      day: new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10),
      status: i === 10 || i === 11 ? "partial_outage" : "operational",
      uptime: 100,
    }));
    const { unmount } = show(
      { id: "w", type: "year-calendar", width: "full", props: { provider: "github" } },
      { providerCalendar: { providerId: "github", days: 365, cells, uptime: 99.9, measuredDays: 60 } },
    );
    expect((await screen.findAllByText(/2 days with trouble out of 60/)).length).toBeGreaterThan(0);
    unmount();
    show(
      { id: "w", type: "year-calendar", width: "full", props: { provider: "github" } },
      { providerCalendar: { providerId: "github", days: 365, cells: cells.slice(0, 3), uptime: 99.9, measuredDays: 3 } },
    );
    expect(await screen.findByText(t("widget.year-calendar.young", { count: 3 }))).toBeInTheDocument();
  });

  const grid = (cells: [number, number, number][]) => {
    const out = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    for (const [d, h, n] of cells) out[d]![h] = n;
    return out;
  };

  it("weekday × hour: states the window incidents cluster in", async () => {
    show(
      { id: "w", type: "weekday-hours", width: "full", props: {} },
      { reliability: { days: 90, providers: [], byWeekdayHour: grid([[1, 15, 4], [1, 16, 3], [1, 17, 2], [3, 9, 2], [5, 2, 1]]) } },
    );
    expect(await screen.findAllByText(/9 of 12 incidents began/)).not.toHaveLength(0);
  });

  it("weekday × hour: too few incidents is not a habit", async () => {
    show({ id: "w", type: "weekday-hours", width: "full", props: {} }, { reliability: { days: 90, providers: [], byWeekdayHour: grid([[1, 15, 4]]) } });
    expect(await screen.findByText(t("widget.weekday-hours.few", { count: 4, floor: 10 }))).toBeInTheDocument();
  });

  it("reliability: names who breaks most often and who repairs slowest", async () => {
    const row = (providerId: string, incidents: number, mttr: number, mtbf: number) => ({
      providerId, incidents, mttrMinutes: mttr, resolved: incidents, mtbfMinutes: mtbf, longestOutageMinutes: mttr, downtimeMinutes: mttr * incidents, previousIncidents: incidents,
    });
    show(
      { id: "w", type: "reliability", width: "full", props: { filter: none } },
      { reliability: { days: 90, providers: [row("cloudflare", 10, 47, 13_000), row("github", 2, 156, 60_000)], byWeekdayHour: grid([]) } },
    );
    expect(await screen.findByText(/Cloudflare breaks most often/)).toBeInTheDocument();
    expect(screen.getByText(/GitHub takes longest to fix/)).toBeInTheDocument();
  });

  it("annotations: links a deploy to the incident that followed it", async () => {
    show(
      { id: "w", type: "annotations", width: "full", props: {} },
      {
        annotations: { annotations: [{ id: 1, at: iso(60), label: "deploy api v4.2", colour: "accent", providerId: null, createdAt: iso(60) }] },
        incidents: incidents([incident("cloudflare", "major", 38, "Workers")]),
      },
    );
    expect(await screen.findByText(/began 22 min after “deploy api v4.2”/)).toBeInTheDocument();
  });

  it("annotations: with no marker, says how to send one", async () => {
    show({ id: "w", type: "annotations", width: "full", props: {} });
    expect(await screen.findByRole("link", { name: t("widget.annotations.add") })).toBeInTheDocument();
  });

  it("delivery: a lost alert names its channel", async () => {
    const sent = (channel: string, ok: boolean, minutesAgo: number) => ({
      providerId: "github", channel, kind: "status_change", text: "x", sentAt: iso(minutesAgo), ok, ...(ok ? {} : { error: "410 Gone" }),
    });
    show(
      { id: "w", type: "delivery", width: "full", props: {} },
      {
        deliveryLog: { page: { items: [sent("telegram", true, 30), sent("slack", false, 120), sent("slack", true, 200)], page: 1, pageSize: 200, total: 3 }, counts: { all: 3, sent: 2, failed: 1 } },
        config: { services: [], channels: [{ id: "telegram", enabled: true }, { id: "slack", enabled: true }] },
      },
    );
    expect(await screen.findByText(/lost an alert .* \(410 Gone\)/)).toBeInTheDocument();
  });

  it("delivery: no channel at all is a dead end it points out of", async () => {
    show({ id: "w", type: "delivery", width: "full", props: {} }, { deliveryLog: { page: { items: [], page: 1, pageSize: 200, total: 0 }, counts: { all: 0, sent: 0, failed: 0 } }, config: { services: [], channels: [] } });
    expect(await screen.findByText(t("widget.delivery.no-channels"))).toBeInTheDocument();
  });

  it("heartbeats: a job past its period and grace has gone quiet", async () => {
    show(
      { id: "w", type: "heartbeats", width: "full", props: {} },
      {
        config: {
          services: [
            { id: "backup", name: "backup", adapter: "heartbeat", baseUrl: "https://heartbeat.invalid", enabled: true, options: { every: "1h" } },
            { id: "sync", name: "sync", adapter: "heartbeat", baseUrl: "https://heartbeat.invalid", enabled: true, options: { every: "15m", grace: "10m" } },
          ],
          channels: [],
        },
        heartbeats: { enabled: true, tokenRevealed: false, heartbeats: [{ providerId: "backup", url: null, lastPingAt: iso(5), pings: 3 }, { providerId: "sync", url: null, lastPingAt: iso(40), pings: 9 }] },
      },
    );
    expect(await screen.findByText(/sync has gone quiet/)).toBeInTheDocument();
    expect(screen.getAllByText(t("widget.heartbeats.meta", { count: 2, fine: 1 })).length).toBeGreaterThan(0);
  });

  it("heartbeats: none watched, and how to start", async () => {
    show({ id: "w", type: "heartbeats", width: "full", props: {} }, { config: { services: [], channels: [] } });
    expect(await screen.findByText(t("widget.heartbeats.none"))).toBeInTheDocument();
  });

  it("break together: offers to declare a strong pair as a dependency, and does", async () => {
    const pair = { providerId: "cloudflare", otherId: "github", together: 4, incidents: 4, rate: 1, lift: 5, declared: false };
    show(
      { id: "w", type: "coincidence", width: "full", props: {} },
      { coincidence: { days: 90, pairs: [pair] }, config: { services: [{ id: "cloudflare", name: "Cloudflare", adapter: "statuspage", baseUrl: "https://x", enabled: true }], channels: [] } },
    );
    const reads = globalThis.fetch;
    const writes: { path: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit): Promise<unknown> => {
      if ((init?.method ?? "GET") === "GET") return reads(input, init);
      writes.push({ path: String(input), body: JSON.parse(String(init?.body)) });
      return { ok: true, status: 200, text: async () => "{}" };
    }));
    fireEvent.click(await screen.findByRole("button", { name: t("widget.coincidence.declare", { a: "Cloudflare", b: "GitHub" }) }));
    await waitFor(() => expect(writes[0]?.body).toEqual({ dependsOn: ["github"] }));
    expect(writes[0]?.path).toContain("/config/services/cloudflare");
  });

  it("break together: independent failures are good news", async () => {
    show({ id: "w", type: "coincidence", width: "full", props: {} });
    expect(await screen.findByText(t("widget.coincidence.none", { days: 90 }))).toBeInTheDocument();
  });

  it("delivery: says nothing about channels until the configuration has arrived", async () => {
    show(
      { id: "w", type: "delivery", width: "full", props: {} },
      { deliveryLog: { page: { items: [], page: 1, pageSize: 200, total: 0 }, counts: { all: 0, sent: 0, failed: 0 } }, config: () => new Promise(() => {}) },
    );
    const card = await screen.findByText(t("dashboard.widget.delivery.title"));
    expect(card.closest("[data-slot=widget-card]")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText(t("widget.delivery.no-channels"))).toBeNull();
  });

  it("error budget: a failed read says so and offers a retry, instead of waiting for ever", async () => {
    show({ id: "w", type: "error-budget", width: "full", props: { filter: none } }, { errors: { sla: 500 } });
    expect(await screen.findByRole("alert")).toHaveTextContent(t("widget.load-failed"));
    expect(screen.getByRole("button", { name: t("action.retry") })).toBeInTheDocument();
  });

  it("break together: will not declare before it knows the provider's current dependencies", async () => {
    const pair = { providerId: "cloudflare", otherId: "github", together: 4, incidents: 4, rate: 1, lift: 5, declared: false };
    show({ id: "w", type: "coincidence", width: "full", props: {} }, { coincidence: { days: 90, pairs: [pair] }, config: () => new Promise(() => {}) });
    expect(await screen.findByRole("button", { name: t("widget.coincidence.declare", { a: "Cloudflare", b: "GitHub" }) })).toBeDisabled();
  });

  // The third round (roadmap 4.1, designed with 4.3 and 4.4).
  describe("third round", () => {
    const trustCard = (pageId: string, counted: number, never: number, median: number) => ({
      key: `probe-${pageId}`,
      pair: { probeId: `probe-${pageId}`, pageId, componentId: "" },
      days: 90,
      counted,
      never,
      delay: { medianMinutes: median, p90Minutes: median * 2, admitted: counted - never },
      coverage: null,
    });
    const fleet = (providers: ReturnType<typeof providerFixture>[], extra: Record<string, unknown> = {}) => ({
      status: { ...status, providers, ...extra },
    });

    it("who says it first: slowest page first, with the fleet's median in the sentence", async () => {
      show(
        { id: "w", type: "page-delay", width: "full", props: {} },
        { trust: { days: 90, windows: [30, 90, 365], cards: [trustCard("github", 10, 1, 7), trustCard("cloudflare", 12, 0, 14)] } },
      );
      expect(await screen.findByText(t("widget.page-delay.conclusion", { minutes: 11, provider: "Cloudflare", slowest: 14 }))).toBeInTheDocument();
    });

    it("who says it first: below the floor, says how to start measuring", async () => {
      show({ id: "w", type: "page-delay", width: "full", props: {} });
      expect(await screen.findByText(t("widget.page-delay.none"))).toBeInTheDocument();
    });

    it("suspected: names a page that reads fine while its probe does not", async () => {
      show(
        { id: "w", type: "suspected", width: "full", props: { filter: none } },
        fleet([providerFixture({ id: "github", name: "GitHub", suspected: { status: "major_outage", probeId: "p", since: iso(9) } })]),
      );
      expect(await screen.findByText(t("widget.suspected.conclusion", { count: 1 }))).toBeInTheDocument();
      expect(screen.getByText(t("widget.suspected.versus", { page: t("status.operational"), probe: t("status.major-outage") }))).toBeInTheDocument();
    });

    it("suspected: agreement is good news, said in words", async () => {
      show({ id: "w", type: "suspected", width: "full", props: { filter: none } });
      expect(await screen.findByText(t("widget.suspected.none", { count: 3 }))).toBeInTheDocument();
    });

    it("stale readings: a failing adapter is named with its error count", async () => {
      show(
        { id: "w", type: "stale-readings", width: "full", props: { filter: none } },
        fleet([providerFixture({ id: "github", name: "GitHub", failureCount: 5 }), providerFixture({ id: "stripe", name: "Stripe" })]),
      );
      expect(await screen.findByText(t("widget.stale-readings.failing", { count: 5 }))).toBeInTheDocument();
      expect(screen.getByText(t("widget.stale-readings.meta", { count: 1, total: 2 }))).toBeInTheDocument();
    });

    it("muted: lists a muted provider and lifts the mute on request", async () => {
      show(
        { id: "w", type: "muted", width: "full", props: {} },
        fleet([providerFixture({ id: "github", name: "GitHub", mutedUntil: ahead(200) })]),
      );
      const reads = globalThis.fetch;
      const writes: { path: string; body: unknown }[] = [];
      vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit): Promise<unknown> => {
        if ((init?.method ?? "GET") === "GET") return reads(input, init);
        writes.push({ path: String(input), body: JSON.parse(String(init?.body)) });
        return { ok: true, status: 200, text: async () => "{}" };
      }));
      fireEvent.click(await screen.findByRole("button", { name: t("widget.muted.unmute-named", { provider: "GitHub" }) }));
      await waitFor(() => expect(writes[0]?.body).toEqual({ mutedUntil: null }));
      expect(writes[0]?.path).toContain("/config/services/github");
    });

    it("muted: a mute that has run out is not listed", async () => {
      show({ id: "w", type: "muted", width: "full", props: {} }, fleet([providerFixture({ mutedUntil: iso(5) })]));
      expect(await screen.findByText(t("widget.muted.none"))).toBeInTheDocument();
    });

    it("page honesty: the least forthcoming page first, against the most", async () => {
      show(
        { id: "w", type: "page-honesty", width: "full", props: {} },
        { trust: { days: 90, windows: [30, 90, 365], cards: [trustCard("github", 10, 0, 3), trustCard("cloudflare", 10, 5, 9)] } },
      );
      expect(
        await screen.findByText(t("widget.page-honesty.conclusion", { worst: "Cloudflare", worstShare: "50%", best: "GitHub", bestShare: "100%" })),
      ).toBeInTheDocument();
    });

    it("group status: names the member that is the reason", async () => {
      show(
        { id: "w", type: "groups", width: "full", props: {} },
        fleet(status.providers, { groups: [{ id: "edge", providers: ["cloudflare", "github"], status: "major_outage", affected: ["cloudflare"] }] }),
      );
      expect(await screen.findByText(t("widget.groups.meta", { count: 1, hit: 1 }))).toBeInTheDocument();
      expect(screen.getAllByText(t("status.major-outage")).length).toBeGreaterThan(0);
    });

    it("degraded components: shows a broken component an operational provider hides", async () => {
      show(
        { id: "w", type: "degraded-components", width: "full", props: { filter: none } },
        fleet([providerFixture({ id: "github", name: "GitHub", components: [{ id: "c", name: "Codespaces", status: "degraded" }, { id: "a", name: "API", status: "operational" }] })]),
      );
      expect(await screen.findByText(t("widget.degraded-components.meta", { count: 1, providers: 1 }))).toBeInTheDocument();
      expect(screen.getAllByText("Codespaces").length).toBeGreaterThan(0);
      expect(screen.getAllByText(t("widget.degraded-components.provider-fine")).length).toBeGreaterThan(0);
    });

    it("latest alerts: says which landed and which did not", async () => {
      show(
        { id: "w", type: "recent-alerts", width: "full", props: {} },
        {
          notifications: {
            notifications: [
              { providerId: "github", channel: "slack", kind: "incident_opened", text: "GitHub down", sentAt: iso(3), ok: false, attempts: 3 },
              { providerId: "github", channel: "telegram", kind: "incident_opened", text: "GitHub down", sentAt: iso(3), ok: true },
            ],
          },
        },
      );
      expect(await screen.findByText(t("widget.recent-alerts.failed", { count: 3 }))).toBeInTheDocument();
      expect(screen.getAllByText(t("widget.recent-alerts.delivered")).length).toBeGreaterThan(0);
    });

    it("poller pulse: a poller that missed two cycles says it has stopped", async () => {
      show({ id: "w", type: "poller-pulse", width: "full", props: {} }, fleet(status.providers, { lastPollAt: iso(30), nextPollAt: iso(25) }));
      expect(await screen.findByText(t("widget.poller-pulse.state-stalled"))).toBeInTheDocument();
    });

    it("poller pulse: a fresh cycle reads as running", async () => {
      show({ id: "w", type: "poller-pulse", width: "full", props: {} }, fleet(status.providers, { lastPollAt: iso(1), nextPollAt: ahead(4) }));
      expect(await screen.findByText(t("widget.poller-pulse.state-alive"))).toBeInTheDocument();
    });

    it("who got worse: biggest fall first, and too little history said plainly", async () => {
      show({ id: "w", type: "worsened", width: "full", props: { filter: none } });
      expect(await screen.findByText(t("widget.worsened.young", { count: 60 }))).toBeInTheDocument();
    });

    it("noise ranking: the noisiest provider, its count a link to its incidents", async () => {
      show(
        { id: "w", type: "noisy", width: "full", props: { filter: none } },
        {
          reliability: {
            days: 30,
            providers: [
              { providerId: "github", incidents: 7, mttrMinutes: 30, resolved: 7, mtbfMinutes: 100, longestOutageMinutes: 60, downtimeMinutes: 200, previousIncidents: 2 },
              { providerId: "stripe", incidents: 2, mttrMinutes: 10, resolved: 2, mtbfMinutes: 400, longestOutageMinutes: 20, downtimeMinutes: 20, previousIncidents: 0 },
            ],
            byWeekdayHour: [],
          },
        },
      );
      // Twice by design: the third's summary and the full table, one of them hidden by width.
      const links = await screen.findAllByRole("link", { name: t("drill.provider-incidents", { provider: "GitHub", count: 7, days: 30 }) });
      for (const link of links) expect(link.getAttribute("href")).toBe("#/incidents?provider=github&days=30&from=overview");
      expect(screen.getByText(t("widget.noisy.conclusion", { provider: "GitHub", count: 7, total: 9, quiet: 1 }))).toBeInTheDocument();
    });

    it("who to call: an outage carries the impact and owner written on it", async () => {
      show(
        { id: "w", type: "who-to-call", width: "full", props: { filter: none } },
        fleet([providerFixture({ id: "cloudflare", name: "Cloudflare", overallStatus: "major_outage", impact: "Checkout returns 5xx", owner: "infra-oncall" })]),
      );
      expect(await screen.findByText("Checkout returns 5xx")).toBeInTheDocument();
      expect(screen.getByText("infra-oncall")).toBeInTheDocument();
    });

    it("who to call: down without an owner says so rather than leaving a blank", async () => {
      show(
        { id: "w", type: "who-to-call", width: "full", props: { filter: none } },
        fleet([providerFixture({ id: "cloudflare", name: "Cloudflare", overallStatus: "major_outage" })]),
      );
      expect(await screen.findByText(t("widget.who-to-call.no-owner"))).toBeInTheDocument();
    });
  });

  // Roadmap 4.3: a figure opens the rows behind it.
  it("open incidents: the count is a link to the open incidents", async () => {
    show({ id: "w", type: "open-incidents", width: "third", props: { filter: none } }, { incidents: incidents([incident("cloudflare", "critical", 10, "Down")]) });
    const link = await screen.findByRole("link", { name: t("drill.open-incidents", { count: 1 }) });
    expect(link.getAttribute("href")).toBe("#/incidents?state=active&from=overview");
  });
});
