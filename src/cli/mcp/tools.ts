import { z } from "zod";
import type { OverallStatus } from "../watch/schema.ts";
import type { ReadApi } from "./api.ts";
import {
  annotationsSchema,
  fleetStatusSchema,
  incidentPageSchema,
  incidentTimelineSchema,
  providerHistorySchema,
  type IncidentRow,
} from "./schema.ts";

/**
 * The five read-only tools `isitdown mcp` offers (roadmap 7.1). Each is a thin
 * reading of endpoints the dashboard already uses — no tool computes a figure
 * the API does not, except `status_at`, which has no endpoint of its own and
 * is assembled from two that exist (see its comment).
 *
 * Descriptions and errors are English literals rather than catalog keys, as
 * the API's own error messages are: they are protocol text read by a model,
 * not a screen read by the operator.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** The widest window `/incidents/timeline` answers — `ALLOWED_DAYS` in `src/ui/routes/historyWindow.ts`. */
const TIMELINE_WINDOWS = [7, 30, 90] as const;
/** `/incidents` caps a page at 100; this bounds how many pages one search may read. */
const INCIDENT_PAGE_SIZE = 100;
const MAX_INCIDENT_PAGES = 20;

export interface ToolContext {
  api: ReadApi;
  now: () => Date;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: unknown, context: ToolContext): Promise<unknown>;
}

/** A call whose arguments cannot be answered — surfaced as the tool's own error, which the model can correct. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

function parseArgs<T extends z.ZodTypeAny>(schema: T, args: unknown): z.infer<T> {
  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) {
    throw new ToolInputError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`).join("; "),
    );
  }
  return parsed.data;
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const daySchema = z.string().regex(DAY_PATTERN, "must be YYYY-MM-DD");
const providerListSchema = z.array(z.string().min(1)).optional();

/** A window as `/history` and `/annotations` take one: `days`, or `from` and `to` together. */
const windowShape = {
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
  from: daySchema.optional(),
  to: daySchema.optional(),
};

const windowJson = {
  days: { type: "integer", enum: [7, 30, 90], description: "A fixed window ending today. Ignored when from/to are given." },
  from: { type: "string", pattern: DAY_PATTERN.source, description: "First day, YYYY-MM-DD, inclusive. Needs to." },
  to: { type: "string", pattern: DAY_PATTERN.source, description: "Last day, YYYY-MM-DD, inclusive. Needs from." },
};

function windowQuery(args: { days?: number | undefined; from?: string | undefined; to?: string | undefined }) {
  if ((args.from === undefined) !== (args.to === undefined)) throw new ToolInputError("from and to must be given together");
  return args.from === undefined ? { days: args.days } : { from: args.from, to: args.to };
}

function unknownIds(asked: readonly string[] | undefined, known: ReadonlySet<string>): string[] {
  return (asked ?? []).filter((id) => !known.has(id));
}

const fleetStatus: Tool = {
  name: "fleet_status",
  title: "Fleet status",
  description:
    "Current status of every monitored provider (or only the ones named): overall status, open incidents, active maintenance, 90-day uptime and when it was last read.",
  inputSchema: {
    type: "object",
    properties: {
      providers: { type: "array", items: { type: "string" }, description: "Provider ids to keep. Omit for the whole fleet." },
    },
    additionalProperties: false,
  },
  async run(args, { api }) {
    const { providers } = parseArgs(z.object({ providers: providerListSchema }).strict(), args);
    const status = await api.get("/status", {}, fleetStatusSchema);
    const wanted = providers === undefined ? null : new Set(providers);
    return {
      serverNow: status.serverNow,
      providers: status.providers
        .filter((provider) => wanted === null || wanted.has(provider.id))
        .map((provider) => ({
          id: provider.id,
          name: provider.name,
          enabled: provider.enabled,
          overallStatus: provider.overallStatus,
          fetchedAt: provider.fetchedAt,
          activeIncidents: (provider.activeIncidents ?? []).map(({ name, impact, status: state, updatedAt }) => ({
            name,
            impact,
            status: state,
            updatedAt,
          })),
          activeMaintenance: provider.maintenance?.active ?? [],
          uptime90: provider.uptime90 ?? null,
          suspected: provider.suspected ?? null,
          stale: provider.stale ?? null,
        })),
      unknownProviders: unknownIds(providers, new Set(status.providers.map((provider) => provider.id))),
    };
  },
};

const providerHistory: Tool = {
  name: "provider_history",
  title: "Provider history",
  description:
    "One provider's history over a window: for each day its worst status and its uptime percentage (null when nothing was measured), plus the window's incident count and downtime. Days are the instance's calendar days.",
  inputSchema: {
    type: "object",
    properties: { provider: { type: "string", description: "Provider id, as fleet_status lists it." }, ...windowJson },
    required: ["provider"],
    additionalProperties: false,
  },
  async run(args, { api }) {
    const parsed = parseArgs(z.object({ provider: z.string().min(1), ...windowShape }).strict(), args);
    const history = await api.get("/history", { provider: parsed.provider, ...windowQuery(parsed) }, providerHistorySchema);
    const uptimeByDay = new Map(history.dailySeries.map((entry) => [entry.day, entry.uptime]));
    return {
      providerId: history.providerId,
      days: history.buckets.map((bucket) => ({
        day: bucket.day,
        worstStatus: bucket.status,
        uptime: uptimeByDay.get(bucket.day) ?? null,
      })),
      sampleCount: history.sampleCount,
      incidentCount: history.incidentCount,
      downtimeMinutes: history.downtimeMinutes,
    };
  },
};

function compactIncident(row: IncidentRow) {
  return {
    providerId: row.providerId,
    incidentId: row.incidentId,
    name: row.name,
    impact: row.impact,
    startedAt: row.startedAt,
    resolvedAt: row.resolvedAt,
  };
}

const incidentsSearch: Tool = {
  name: "incidents_search",
  title: "Search incidents",
  description:
    "Incidents recorded for the fleet, newest first: filter by provider, by text in the incident name, by state, and by the days they started in.",
  inputSchema: {
    type: "object",
    properties: {
      provider: { type: "string", description: "Provider id. Omit for every provider." },
      q: { type: "string", description: "Text the incident name contains, case-insensitive." },
      state: { type: "string", enum: ["all", "active", "resolved"], description: "Default all." },
      from: { type: "string", pattern: DAY_PATTERN.source, description: "Started on or after this day, YYYY-MM-DD." },
      to: { type: "string", pattern: DAY_PATTERN.source, description: "Started on or before this day, YYYY-MM-DD." },
      limit: { type: "integer", minimum: 1, maximum: 200, description: "Most incidents to return. Default 50." },
    },
    additionalProperties: false,
  },
  async run(args, { api, now }) {
    const parsed = parseArgs(
      z
        .object({
          provider: z.string().min(1).optional(),
          q: z.string().max(120).optional(),
          state: z.enum(["all", "active", "resolved"]).optional(),
          from: daySchema.optional(),
          to: daySchema.optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .strict(),
      args,
    );
    const limit = parsed.limit ?? 50;
    // `/incidents` windows by "started within the last N days"; `from` becomes
    // that N, and `to` is applied here, since the list has no upper bound.
    const days =
      parsed.from === undefined
        ? undefined
        : Math.max(1, Math.ceil((now().getTime() - Date.parse(`${parsed.from}T00:00:00.000Z`)) / DAY_MS) + 1);
    const before = parsed.to === undefined ? null : `${parsed.to}T23:59:59.999Z`;

    const found: IncidentRow[] = [];
    let exhausted = false;
    for (let page = 1; page <= MAX_INCIDENT_PAGES && found.length < limit; page++) {
      const answer = await api.get(
        "/incidents",
        { provider: parsed.provider, q: parsed.q, state: parsed.state, days, page, pageSize: INCIDENT_PAGE_SIZE },
        incidentPageSchema,
      );
      for (const row of answer.page.items) {
        if (before === null || row.startedAt <= before) found.push(row);
      }
      if (page * INCIDENT_PAGE_SIZE >= answer.page.total || answer.page.items.length === 0) {
        exhausted = true;
        break;
      }
    }
    return {
      incidents: found.slice(0, limit).map(compactIncident),
      truncated: !exhausted || found.length > limit,
    };
  },
};

/** How bad an open incident's impact word is, read the way Statuspage defines the words. */
function impactStatus(impact: string): OverallStatus {
  switch (impact) {
    case "critical":
      return "major_outage";
    case "major":
      return "partial_outage";
    case "none":
    case "maintenance":
      return "operational";
    default:
      return "degraded";
  }
}

const STATUS_RANK: Record<OverallStatus, number> = {
  unknown: -1,
  operational: 0,
  degraded: 1,
  partial_outage: 2,
  major_outage: 3,
};

const statusAt: Tool = {
  name: "status_at",
  title: "Status at an instant",
  description:
    "What one or more providers were going through at a precise instant in the last 90 days: the incidents open at that moment and the status they imply, beside the worst status and the uptime of the whole day around it.",
  inputSchema: {
    type: "object",
    properties: {
      at: { type: "string", format: "date-time", description: "The instant, ISO 8601 with an offset, e.g. 2026-11-25T15:00:00+01:00." },
      providers: { type: "array", items: { type: "string" }, description: "Provider ids. Omit for every enabled provider." },
    },
    required: ["at"],
    additionalProperties: false,
  },
  /**
   * The API has no "status at" endpoint, and the server is not to grow one
   * for this (roadmap 7.1), so the answer is assembled from two readings it
   * does have: `/incidents/timeline` for the incidents open at the instant —
   * which is what "was it degraded at 15:00" asks — and the day's bucket from
   * `/history` for the worst reading around it, which also says whether the
   * provider was measured at all that day. Bounded by the timeline's widest
   * window, 90 days.
   */
  async run(args, { api, now }) {
    const parsed = parseArgs(
      z.object({ at: z.string().datetime({ offset: true }), providers: providerListSchema }).strict(),
      args,
    );
    const atMs = Date.parse(parsed.at);
    const ageMs = now().getTime() - atMs;
    if (ageMs < 0) throw new ToolInputError("at is in the future");
    const window = TIMELINE_WINDOWS.find((days) => ageMs < days * DAY_MS);
    if (window === undefined) throw new ToolInputError("at must be within the last 90 days");

    const [status, timeline] = await Promise.all([
      api.get("/status", {}, fleetStatusSchema),
      api.get("/incidents/timeline", { days: window }, incidentTimelineSchema),
    ]);
    const known = new Set(status.providers.map((provider) => provider.id));
    const ids = parsed.providers?.filter((id) => known.has(id)) ??
      status.providers.filter((provider) => provider.enabled).map((provider) => provider.id);
    const at = new Date(atMs).toISOString();
    const day = at.slice(0, 10);

    const providers = await Promise.all(
      ids.map(async (id) => {
        const open = timeline.incidents.filter(
          (row) => row.providerId === id && row.startedAt <= at && (row.resolvedAt === null || row.resolvedAt > at),
        );
        const history = await api.get("/history", { provider: id, from: day, to: day }, providerHistorySchema);
        const dayWorstStatus = history.buckets[0]?.status ?? "unknown";
        const fromIncidents = open.reduce<OverallStatus>(
          (worst, row) => (STATUS_RANK[impactStatus(row.impact)] > STATUS_RANK[worst] ? impactStatus(row.impact) : worst),
          "operational",
        );
        return {
          id,
          // Nothing open and nothing measured that day is not "operational":
          // nobody was watching.
          status: open.length === 0 && dayWorstStatus === "unknown" ? "unknown" : fromIncidents,
          openIncidents: open.map(compactIncident),
          day,
          dayWorstStatus,
          dayUptime: history.dailySeries[0]?.uptime ?? null,
        };
      }),
    );
    return { at, providers, unknownProviders: unknownIds(parsed.providers, known) };
  },
};

const annotationsList: Tool = {
  name: "annotations_list",
  title: "Annotations",
  description:
    "The operator's own timeline markers — deploys, migrations, config changes — over a window, oldest first. Naming a provider returns its markers and the fleet-wide ones.",
  inputSchema: {
    type: "object",
    properties: { provider: { type: "string", description: "Provider id. Omit for every marker." }, ...windowJson },
    additionalProperties: false,
  },
  async run(args, { api }) {
    const parsed = parseArgs(z.object({ provider: z.string().min(1).optional(), ...windowShape }).strict(), args);
    const answer = await api.get("/annotations", { provider: parsed.provider, ...windowQuery(parsed) }, annotationsSchema);
    return {
      annotations: answer.annotations.map(({ id, at, label, providerId }) => ({ id, at, label, providerId })),
    };
  },
};

export const TOOLS: readonly Tool[] = [fleetStatus, providerHistory, incidentsSearch, statusAt, annotationsList];
