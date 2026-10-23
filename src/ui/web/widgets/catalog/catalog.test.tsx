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
});
