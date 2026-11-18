import type { ComponentType } from "react";
import { UptimeBarRow } from "@/components/charts/UptimeBarRow.tsx";
import { UptimeStrip } from "@/components/charts/UptimeStrip.tsx";
import { IncidentBand } from "@/components/IncidentBand.tsx";
import { IncidentTimelineCard } from "@/components/IncidentTimelineCard.tsx";
import { EngineSection } from "@/components/settings/EngineSection.tsx";
import type { HistoryBucket, OverallStatus, ProviderStatus, RuntimeConfigResponse } from "@/lib/types.ts";
import type { Fixtures } from "@/test/fakeApi.ts";
import { ProviderTile } from "@/widgets/catalog/ProviderTile.tsx";

/**
 * The component catalog's registry (roadmap 13.9): every catalogued component
 * in every state worth looking at, as plain data. Themes and locales are not
 * listed here — every story is rendered in all of them by whoever shows it
 * (the catalog page, the visual harness).
 *
 * A story is `{ component, props, state }`, plus what the fake API answers
 * while it renders (`fixtures`) and what the browser remembers (`storage`) —
 * a folded card opened, an incident already seen ending. Data-fetching
 * components get their loading, empty and error states the honest way: the
 * request is held, answered empty, or failed, never a prop that fakes it.
 */
export type StoryState = "loading" | "empty" | "error" | "populated";

export interface Story<P extends object = object> {
  /** `<component>--<variant>`, the name of its visual baseline too. */
  id: string;
  component: ComponentType<P>;
  props: P;
  state: StoryState;
  fixtures?: Fixtures;
  storage?: Record<string, string>;
  /** CSS width the component is shown at; its container decides most layouts. */
  width?: number;
}

const story = <P extends object>(entry: Story<P>): Story => entry as unknown as Story;

const SEVERITIES: OverallStatus[] = ["operational", "degraded", "partial_outage", "major_outage", "unknown"];
const DAY = 86_400_000;
const MINUTE = 60_000;
/** Never settles: how a story holds a request on the wire. */
const pending = () => new Promise<never>(() => {});

/**
 * Built at call time, not import time: relative to the clock the page runs
 * on, so the catalog reads "now" in a dev server and the visual harness's
 * frozen instant gives every frame the same dates.
 */
export function stories(): Story[] {
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const dayOf = (daysAgo: number) => iso(daysAgo * DAY).slice(0, 10);

  /** 90 days, oldest first: quiet, with one bad week and a day nobody measured. */
  const buckets: HistoryBucket[] = Array.from({ length: 90 }, (_, index) => {
    const daysAgo = 89 - index;
    const status: OverallStatus =
      daysAgo === 3 ? "major_outage" : daysAgo === 4 ? "partial_outage" : daysAgo >= 5 && daysAgo <= 7 ? "degraded" : daysAgo === 40 ? "unknown" : "operational";
    return { day: dayOf(daysAgo), status };
  });
  /** Every severity side by side, so a colour token change shows in one strip. */
  const everySeverity: HistoryBucket[] = Array.from({ length: 30 }, (_, index) => ({
    day: dayOf(29 - index),
    status: SEVERITIES[Math.floor(index / 6)] ?? "operational",
  }));

  const provider = (over: Partial<ProviderStatus>): ProviderStatus => ({
    id: "github",
    name: "GitHub",
    adapter: "statuspage",
    baseUrl: "https://www.githubstatus.com",
    enabled: true,
    overallStatus: "operational",
    activeIncidents: [],
    components: [],
    componentSelection: [],
    scopeToComponents: false,
    authority: "declared",
    fetchedAt: iso(2 * MINUTE),
    failureCount: 0,
    uptime90: 99.94,
    maintenance: { active: [], upcoming: [] },
    ...over,
  });

  const outage = { id: "inc1", name: "Elevated 5xx errors on Workers", impact: "major", status: "identified", updatedAt: iso(20 * MINUTE) };
  const cloudflareDown = provider({
    id: "cloudflare",
    name: "Cloudflare",
    baseUrl: "https://www.cloudflarestatus.com",
    overallStatus: "major_outage",
    activeIncidents: [outage],
    uptime90: 99.41,
  });
  const githubDegraded = provider({ overallStatus: "degraded", uptime90: 99.87 });
  const incidentDetail = {
    incident: { providerId: "cloudflare", incidentId: "inc1", name: outage.name, impact: "major", status: "identified", startedAt: iso(48 * MINUTE), updatedAt: outage.updatedAt, resolvedAt: null },
    timeline: [
      { at: iso(48 * MINUTE), label: "opened", status: "investigating" },
      { at: iso(20 * MINUTE), label: "observed", status: "identified" },
    ],
    actionLog: [],
    polls: [],
    otherActiveIncidents: [],
    notes: [{ id: 1, body: "traffic moved to us-east", createdAt: iso(10 * MINUTE) }],
  };

  // The tile reads the fleet, its history and reliability — one answer each.
  const tileFixtures = (shown: ProviderStatus): Fixtures => ({
    status: { providers: [shown] },
    history: {
      aggregateUptime: shown.uptime90,
      aggregateDelta: null,
      dailyUptime: [],
      months: [],
      providers: [{ providerId: shown.id, buckets: buckets.slice(-30), uptime7: 99, uptime30: 99.5, uptime90: shown.uptime90, sampleCount: 1000, incidentCount: 4, downtimeMinutes: 95, dailySeries: [] }],
    },
    reliability: {
      days: 30,
      providers: [{ providerId: shown.id, incidents: 4, mttrMinutes: 47, resolved: 4, mtbfMinutes: 9_000, longestOutageMinutes: 80, downtimeMinutes: 95, previousIncidents: 2 }],
      byWeekdayHour: [],
    },
    incidents: {
      active: shown.activeIncidents.map((incident) => ({ providerId: shown.id, incidentId: incident.id, name: incident.name, impact: incident.impact, status: incident.status, startedAt: iso(48 * MINUTE), updatedAt: incident.updatedAt, resolvedAt: null })),
      page: { items: [], page: 1, pageSize: 1, total: 0 },
      counts: { all: 0, active: shown.activeIncidents.length, resolved: 0 },
    },
  });

  const timelineProviders = [
    { id: "github", name: "GitHub" },
    { id: "cloudflare", name: "Cloudflare" },
    { id: "stripe", name: "Stripe" },
  ];
  const timelineRow = (providerId: string, incidentId: string, impact: string, startedDaysAgo: number, hours: number | null) => ({
    providerId,
    incidentId,
    name: `${providerId} ${impact} incident`,
    impact,
    startedAt: iso(startedDaysAgo * DAY),
    resolvedAt: hours === null ? null : iso(startedDaysAgo * DAY - hours * 3_600_000),
  });
  const timelineOpen = { "isitdown.widget-open.incidents-timeline": "1" };

  const config = {
    polling: {
      intervalMinutes: 5,
      requestTimeoutSeconds: 10,
      maxRetries: 3,
      failureThreshold: 3,
      adaptivePolling: true,
      adaptiveIntervalMinutes: 1,
      confirmSamples: 2,
    },
    retention: { days: 120 },
    locale: "en",
    services: [],
    channels: [],
    routing: { rules: [], invalidRules: 0 },
  } as unknown as RuntimeConfigResponse;

  return [
    // Provider tile: every severity, a suspected reading, and the three states
    // around it — no such provider, still loading, the fleet unreachable.
    ...SEVERITIES.map((status) =>
      story({
        id: `provider-tile--${status.replace("_", "-")}`,
        component: ProviderTile,
        props: { props: { provider: "github" } },
        state: "populated",
        width: 720,
        fixtures: tileFixtures(provider({ overallStatus: status, ...(status === "major_outage" ? { activeIncidents: [outage] } : {}) })),
      }),
    ),
    story({
      id: "provider-tile--suspected",
      component: ProviderTile,
      props: { props: { provider: "github" } },
      state: "populated",
      width: 720,
      fixtures: tileFixtures(provider({ suspected: { status: "partial_outage", probeId: "eu-west", since: iso(15 * MINUTE) } })),
    }),
    story({
      id: "provider-tile--missing",
      component: ProviderTile,
      props: { props: { provider: "gone" } },
      state: "empty",
      width: 720,
      fixtures: tileFixtures(provider({})),
    }),
    story({
      id: "provider-tile--loading",
      component: ProviderTile,
      props: { props: { provider: "github" } },
      state: "loading",
      width: 720,
      fixtures: { status: pending },
    }),
    story({
      id: "provider-tile--error",
      component: ProviderTile,
      props: { props: { provider: "github" } },
      state: "error",
      width: 720,
      fixtures: { errors: { status: 503 } },
    }),

    // Uptime bars: a quarter with a bad week, every severity, nothing yet.
    story({ id: "uptime-bar--populated", component: UptimeBarRow, props: { buckets }, state: "populated", width: 720 }),
    story({ id: "uptime-bar--severities", component: UptimeBarRow, props: { buckets: everySeverity, showAxis: true }, state: "populated", width: 720 }),
    story({ id: "uptime-bar--empty", component: UptimeBarRow, props: { buckets: [] }, state: "empty", width: 720 }),
    story({ id: "uptime-strip--populated", component: UptimeStrip, props: { buckets }, state: "populated", width: 480 }),
    story({ id: "uptime-strip--severities", component: UptimeStrip, props: { buckets: everySeverity }, state: "populated", width: 480 }),

    // Incident timeline: lanes with an overlap, nothing in the window, held, failed.
    story({
      id: "incident-timeline--populated",
      component: IncidentTimelineCard,
      props: { providers: timelineProviders },
      state: "populated",
      width: 960,
      storage: timelineOpen,
      fixtures: {
        timeline: {
          days: 30,
          incidents: [
            timelineRow("github", "a", "minor", 20, 6),
            timelineRow("cloudflare", "b", "major", 20, 10),
            timelineRow("stripe", "c", "critical", 9, 2),
            timelineRow("cloudflare", "d", "major", 1, null),
          ],
        },
      },
    }),
    story({
      id: "incident-timeline--empty",
      component: IncidentTimelineCard,
      props: { providers: timelineProviders },
      state: "empty",
      width: 960,
      storage: timelineOpen,
      fixtures: { timeline: { days: 30, incidents: [] } },
    }),
    story({
      id: "incident-timeline--loading",
      component: IncidentTimelineCard,
      props: { providers: timelineProviders },
      state: "loading",
      width: 960,
      storage: timelineOpen,
      fixtures: { timeline: pending },
    }),
    story({
      id: "incident-timeline--error",
      component: IncidentTimelineCard,
      props: { providers: timelineProviders },
      state: "error",
      width: 960,
      storage: timelineOpen,
      fixtures: { errors: { timeline: 500 } },
    }),

    // Incident card: the band an outage puts on the Overview, the strip it
    // leaves behind, and its updates held or failed.
    story({
      id: "incident-card--populated",
      component: IncidentBand,
      props: { providers: [cloudflareDown, githubDegraded] },
      state: "populated",
      width: 960,
      fixtures: { incident: incidentDetail, annotations: { annotations: [] } },
    }),
    story({
      id: "incident-card--resolved",
      component: IncidentBand,
      props: { providers: [provider({})] },
      state: "empty",
      width: 960,
      storage: {
        "isitdown.incident-mode.last": JSON.stringify({
          providerId: "cloudflare",
          providerName: "Cloudflare",
          incidentId: "inc1",
          name: outage.name,
          startedAt: iso(80 * MINUTE),
          endedAt: iso(3 * MINUTE),
        }),
      },
    }),
    story({
      id: "incident-card--loading",
      component: IncidentBand,
      props: { providers: [cloudflareDown] },
      state: "loading",
      width: 960,
      fixtures: { incident: pending, annotations: { annotations: [] } },
    }),
    story({
      id: "incident-card--error",
      component: IncidentBand,
      props: { providers: [cloudflareDown] },
      state: "error",
      width: 960,
      fixtures: { errors: { incident: 500 }, annotations: { annotations: [] } },
    }),

    // Settings form: the engine section, the densest form on the page.
    story({ id: "settings-engine--populated", component: EngineSection, props: { config }, state: "populated", width: 800 }),
  ];
}
