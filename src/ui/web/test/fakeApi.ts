import { DEFAULT_LAYOUT } from "../../dashboardLayout.ts";

/*
 * The dashboard's API, answered from fixtures instead of a server: which
 * fixture a request path reads, and the response it gets. No test runner in
 * here, so the same answers serve the Vitest harness (which wraps them in a
 * `vi.fn` it can assert on) and the component catalog's stories (roadmap
 * 13.9), which run in a plain browser.
 */

export type FixtureKey =
  | "status"
  | "config"
  | "ai"
  | "operatorSeries"
  | "seriesReading"
  | "aiModels"
  | "summary"
  | "providerPush"
  | "storage"
  | "backupSchedule"
  | "installHealth"
  | "history"
  | "incidents"
  | "incident"
  | "notifications"
  | "deliveryLog"
  | "componentHistory"
  | "providerCalendar"
  | "reliability"
  | "reliabilityWords"
  | "coincidence"
  | "messagePreview"
  | "annotations"
  | "map"
  | "preferences"
  | "maintenances"
  | "serviceImpact"
  | "adapterDebug"
  | "adapterExplain"
  | "replay"
  | "catalog"
  | "dashboard"
  | "dashboards"
  | "sla"
  | "search"
  | "latency"
  | "timeline"
  | "heartbeats"
  | "apiTokens"
  | "trust";

export interface Fixtures {
  status?: unknown;
  config?: unknown;
  history?: unknown;
  incidents?: unknown;
  incident?: unknown;
  notifications?: unknown;
  /** `/notifications/log`, matched before `/notifications` — the log is a nested path with its own shape. */
  deliveryLog?: unknown;
  componentHistory?: unknown;
  /** `/history/calendar`, matched before `/history` — the year heat calendar's own shape. */
  providerCalendar?: unknown;
  /** `/reliability` — MTTR, MTBF and the weekday-hour grid (roadmap 12.2, 12.3). */
  reliability?: unknown;
  /** `/reliability/words`, matched before `/reliability` — what keeps breaking (roadmap 6.9). */
  reliabilityWords?: unknown;
  /** `/coincidence` — providers that break together (roadmap 2.10). */
  coincidence?: unknown;
  /** `/notifications/preview` — what each channel would say (roadmap 14.1). */
  messagePreview?: unknown;
  /** `/annotations` — the operator's own timeline markers (roadmap 12.1). */
  annotations?: unknown;
  map?: unknown;
  preferences?: unknown;
  maintenances?: unknown;
  /** `/config/services/:id/impact`, matched before `/config` — it is a nested config path. */
  serviceImpact?: unknown;
  /** `/config/storage`, matched before `/config` — the retention cost report. */
  storage?: unknown;
  /** `/config/backup/schedule` and `/config/backup/run`, matched before `/config` — roadmap 10.1. */
  backupSchedule?: unknown;
  /** `/config/health`, matched before `/config` — roadmap 5.15 and 5.16. */
  installHealth?: unknown;
  /** `/debug/adapters` — the adapter diagnostics panel's recent reads. */
  adapterDebug?: unknown;
  /** `/debug/adapters/:id/explain`, matched before `adapterDebug` — roadmap 5.11's chain. */
  adapterExplain?: unknown;
  /** `/notifications/:id/replay`, matched before the rest of `/notifications` — roadmap 5.12. */
  replay?: unknown;
  /** `/config/catalog`, matched before `/config` — the bundled provider menu. */
  catalog?: unknown;
  /** `/config/provider-push`, matched before `/config` — roadmap 1.2's subscription card. */
  providerPush?: unknown;
  /** `/dashboards/…` — the Overview's widget layout (roadmap 4.1). */
  dashboard?: unknown;
  /** `GET /dashboards` — the named dashboards list (roadmap 4.2). */
  dashboards?: unknown;
  /** `/sla` — this month's error budgets. */
  sla?: unknown;
  /** `/search` — the palette's text search (roadmap 4.15). */
  search?: unknown;
  /** `/history/latency` — one provider's percentiles (roadmap 4.14). */
  latency?: unknown;
  /** `/incidents/timeline`, matched before `/incidents/` — the Gantt's rows (roadmap 4.12). */
  timeline?: unknown;
  /** `/config/heartbeats`, matched before `/config` — when each job last pinged. */
  heartbeats?: unknown;
  /** `/config/tokens`, matched before `/config` — the API tokens list (roadmap 9.11). */
  apiTokens?: unknown;
  /** `/trust` — how each status page tracked its probe (roadmap 8.1). */
  trust?: unknown;
  /** `/config/ai`, matched before `/config` — Settings → AI implementation (roadmap 6.10). */
  ai?: unknown;
  /** `/config/series`, matched before `/config` — the operator's metrics (roadmap 6.11). */
  operatorSeries?: unknown;
  /** `/series/:id` — one metric over a window (roadmap 6.11). */
  seriesReading?: unknown;
  /** `/config/ai/models`, matched before `/config/ai` — the model menu's choices. */
  aiModels?: unknown;
  /** `/incidents/:p/:i/summary`, matched before `/incidents/` — one written summary (roadmap 6.10). */
  summary?: unknown;
  /**
   * Make one endpoint's fetch fail with this HTTP status instead of
   * returning its fixture body — for exercising the `errorElement` path
   * (routes.tsx's `ViewError`) that a view falls back to on an initial-load
   * failure. Keyed by the same categories as the success fixtures above.
   */
  errors?: Partial<Record<FixtureKey, number>>;
}

/** Which fixture a request path reads. Order matters: nested paths first. */
export function fixtureKeyFor(path: string): FixtureKey {
  return path.endsWith("/replay")
    ? "replay"
    : path.startsWith("/incidents/") && path.endsWith("/summary")
    ? "summary"
    : path.startsWith("/config/series")
    ? "operatorSeries"
    : path.startsWith("/series/")
    ? "seriesReading"
    : path.startsWith("/config/ai/models")
    ? "aiModels"
    : path.startsWith("/config/ai")
    ? "ai"
    : path.startsWith("/notifications/preview")
    ? "messagePreview"
    : path.startsWith("/coincidence")
    ? "coincidence"
    : path.startsWith("/reliability/words")
    ? "reliabilityWords"
    : path.startsWith("/reliability")
    ? "reliability"
    : path.startsWith("/annotations")
      ? "annotations"
      : path.startsWith("/history/calendar")
        ? "providerCalendar"
        : path.startsWith("/history/latency")
      ? "latency"
      : path.startsWith("/history/components")
          ? "componentHistory"
          : path.startsWith("/history")
            ? "history"
            : path.startsWith("/incidents/timeline")
        ? "timeline"
        : path.startsWith("/incidents/")
              ? "incident"
              : path.startsWith("/incidents")
                ? "incidents"
                : path.startsWith("/maintenances")
                  ? "maintenances"
                  : path.startsWith("/notifications/log")
                    ? "deliveryLog"
                    : path.startsWith("/notifications")
                      ? "notifications"
                      : path.endsWith("/impact")
                        ? "serviceImpact"
                        : path.startsWith("/config/storage")
                          ? "storage"
                          : path.startsWith("/config/backup/schedule") || path.startsWith("/config/backup/run")
                            ? "backupSchedule"
                          : path.startsWith("/config/catalog")
                            ? "catalog"
                            : path.startsWith("/config/provider-push")
                              ? "providerPush"
                            : path.startsWith("/config/heartbeats")
                              ? "heartbeats"
                            : path.startsWith("/config/tokens")
                              ? "apiTokens"
                            : path.startsWith("/search")
                              ? "search"
                            : path.startsWith("/sla")
                              ? "sla"
                            : path.startsWith("/trust")
                              ? "trust"
                            : path.startsWith("/config/health")
                              ? "installHealth"
                            : path.startsWith("/config")
                              ? "config"
                              : path.startsWith("/debug/adapters") && path.endsWith("/explain")
                                ? "adapterExplain"
                              : path.startsWith("/debug/adapters")
                                ? "adapterDebug"
                                : path === "/dashboards"
                                ? "dashboards"
                                : path.startsWith("/dashboards")
                                ? "dashboard"
                                : path.startsWith("/map")
                                  ? "map"
                                  : path.startsWith("/api/preferences")
                                    ? "preferences"
                                    : "status";
}

/** What `fetch` resolves to for `path`, given `fixtures`. */
export async function fakeResponse(
  fixtures: Fixtures,
  path: string,
): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> {
  const key = fixtureKeyFor(path);
  const errorStatus = fixtures.errors?.[key];
  if (errorStatus !== undefined) {
    return { ok: false, status: errorStatus, text: async () => "" };
  }
  // A fixture may be a function of the request path instead of a fixed
  // body, for an endpoint whose answer depends on its query string — a
  // paged, filtered list cannot be represented by one constant response.
  // An unset calendar fixture answers an empty year rather than `{}`: the
  // drawer renders the calendar for every provider it opens, and a body
  // with no `cells` is a shape no server ever sends.
  // Unset fixtures answer the empty shape the server would send rather
  // than `{}`: a view renders these unconditionally, and a body with no
  // `cells`, no `byWeekdayHour` or no `annotations` is a shape no server
  // ever produces — a crash there would be the harness's, not the view's.
  const EMPTY: Partial<Record<FixtureKey, unknown>> = {
    backupSchedule: {
      cron: "",
      keep: 7,
      dir: "/app/data/backups",
      source: { cron: "default", keep: "default" },
      uploads: [],
      nextAt: null,
      lastAttemptAt: null,
      lastOkAt: null,
      lastFile: null,
      lastError: null,
    },
    providerCalendar: {
      providerId: "",
      days: 365,
      cells: [],
      uptime: 0,
      measuredDays: 0,
    },
    reliability: {
      days: 90,
      providers: [],
      byWeekdayHour: Array.from({ length: 7 }, () =>
        Array.from({ length: 24 }, () => 0),
      ),
    },
    coincidence: { days: 90, pairs: [] },
    reliabilityWords: { days: 90, incidents: 0, words: [], phrases: [], components: [] },
    // Nothing to suggest: the launcher renders the checklist for every
    // visit, and a body with no `checks` is a shape no server sends.
    installHealth: { abandoned: [], checks: [] },
    // The provider drawer reads the routing rules to show a component's
    // silence (roadmap 5.13); a config with no `routing` is not a body the
    // server sends.
    config: { routing: { rules: [], invalidRules: 0 } },
    // A provider nothing has read yet, which is the honest default for the panel.
    adapterExplain: {
      id: "acme",
      reading: null,
      components: [],
      rule: "overall",
      told: null,
      damping: { confirmSamples: 1, count: 0, held: false },
    },
    trust: { days: 90, windows: [30, 90, 365], cards: [] },
    aiModels: { models: [] },
    // No metric declared: the timeline draws no metric lane.
    operatorSeries: { series: [] },
    // Off, as every install starts: the incident page offers no summary.
    ai: {
      provider: "off",
      model: "",
      baseUrl: "",
      defaults: { anthropic: "claude-opus-5-5", openai: "", "claude-cli": "" },
      key: { envVar: "AI_API_KEY", set: false, saved: false },
      cliToken: { envVar: "CLAUDE_CODE_OAUTH_TOKEN", set: false, saved: false },
      claudeCli: false,
    },
    annotations: { annotations: [] },
    providerPush: { enabled: false, tokenRevealed: false, providers: [] },
    messagePreview: { kind: "status_change", provider: "GitHub", channels: [] },
    sla: { month: "2026-10", providers: [] },
    search: { query: "", incidents: [], notes: [], annotations: [] },
    latency: { provider: "", range: "7d", slowMs: null, summary: null, points: [] },
    timeline: { days: 30, incidents: [] },
    heartbeats: { enabled: false, tokenRevealed: false, heartbeats: [] },
    apiTokens: { tokens: [], envToken: false },
    dashboards: [
      { id: "default", name: "Overview", home: true, isDefault: true, updatedAt: "2026-08-21T10:00:00.000Z" },
    ],
    dashboard: {
      id: "default",
      name: "Overview",
      layout: DEFAULT_LAYOUT,
      isDefault: true,
      updatedAt: "2026-08-21T10:00:00.000Z",
    },
  };
  const fixture = fixtures[key] ?? EMPTY[key];
  // Awaited, so a fixture can also be a promise that never settles — the
  // way a test holds an endpoint on the wire to see the loading state.
  const body = await (typeof fixture === "function"
    ? (fixture as (path: string) => unknown)(path)
    : fixture);
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body ?? {}),
  };
}
