import { z } from "zod";
import type {
  Adapter,
  ComponentPreview,
  FetchContext,
  IncidentHistoryResult,
  ServiceRef,
} from "../core/adapter.interface.ts";
import type {
  ComponentStatus,
  HistoricalIncident,
  Incident,
  MaintenanceWindow,
  NormalizedStatus,
  OverallStatus,
} from "../core/types.ts";
import { fetchConditional } from "../core/http.ts";

/**
 * Uptime.com status pages (roadmap 1.15).
 *
 * The page is server-rendered, and the same payload it is rendered from is
 * served as JSON beside it: `<page>/ajax` carries the aggregate flag, the
 * component tree, the open incidents and any maintenance about to start, and
 * `<page>/history` carries the closed ones. Both answer inside a `{ error,
 * fields, data }` envelope, which is the one thing to unwrap before anything
 * here looks familiar.
 *
 * `service.baseUrl` is the status page itself rather than the host — an
 * Uptime.com account can publish several, at `/statuspage/<slug>` each, so the
 * host alone does not name one. A page on a custom domain is the same thing with
 * a shorter url.
 *
 * Components nest one level: a group carries its own derived status and the
 * subcomponents under it. The reading folds the leaves, since a group's status
 * is a summary of exactly those.
 */

const AJAX_PATH = "/ajax";
const HISTORY_PATH = "/history";

const componentSchema: z.ZodType<{
  id?: number | string | undefined;
  name?: string | undefined;
  status?: string | undefined;
  is_group?: boolean | undefined;
  subcomponents?: unknown[] | undefined;
}> = z.lazy(() =>
  z.object({
    id: z.union([z.number(), z.string()]).optional(),
    name: z.string().optional(),
    status: z.string().optional(),
    is_group: z.boolean().optional(),
    subcomponents: z.array(componentSchema).default([]),
  }),
);

const affectedSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  name: z.string().optional(),
  status: z.string().optional(),
});

const updateSchema = z.object({
  updated_at: z.string().optional(),
  incident_state: z.string().optional(),
  incident_state_display: z.string().optional(),
});

const incidentSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  name: z.string().optional(),
  /** `INCIDENT` or `SCHEDULED_MAINTENANCE`; the two share this one shape. */
  incident_type: z.string().optional(),
  starts_at: z.string().nullable().optional(),
  ends_at: z.string().nullable().optional(),
  latest_update_incident_state: z.string().nullable().optional(),
  affected_components: z.array(affectedSchema).default([]),
  updates: z.array(updateSchema).default([]),
});

const ajaxSchema = z.object({
  data: z
    .object({
      global_is_operational: z.boolean().optional(),
      components: z.array(componentSchema).default([]),
      active_incidents: z.array(incidentSchema).default([]),
      upcoming_maintenance: z.array(incidentSchema).default([]),
    })
    .optional(),
});

const historySchema = z.object({
  data: z
    .object({
      past_incidents: z.array(incidentSchema).default([]),
      active_incidents: z.array(incidentSchema).default([]),
    })
    .optional(),
});

/**
 * Uptime.com's own vocabulary, read with the punctuation removed so
 * `degraded-performance`, `degraded_performance` and `Degraded Performance` are
 * one word. `maintenance` maps to `unknown`: the normalized model has no
 * maintenance state, and `unknown` abstains in the diff engine rather than
 * reading as a recovery.
 */
const STATUSES: Record<string, OverallStatus> = {
  operational: "operational",
  degradedperformance: "degraded",
  degraded: "degraded",
  partialoutage: "partial_outage",
  majoroutage: "major_outage",
  down: "major_outage",
  maintenance: "unknown",
  undermaintenance: "unknown",
  unknown: "unknown",
  notmonitored: "unknown",
  paused: "unknown",
};

const MAINTENANCE_TYPE = "SCHEDULED_MAINTENANCE";
const RESOLVED = "resolved";

/**
 * A word we have never seen is treated as the worst case, as in every other
 * adapter here: silently downgrading an outage to operational is the one failure
 * mode that matters.
 */
function mapStatus(word: string | undefined): OverallStatus {
  if (word === undefined || word === "") return "unknown";
  return STATUSES[word.toLowerCase().replace(/[^a-z]/g, "")] ?? "major_outage";
}

/** Throws when the body is not this provider's payload — the poller's retry accounting depends on it. */
function parseBody<S extends z.ZodTypeAny>(raw: string, schema: S, service: ServiceRef, what: string): z.infer<S> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`uptimecom ${what} fetch for ${service.id} returned a body that is not JSON`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`uptimecom ${what} fetch for ${service.id} returned a body that is not a status-page payload`);
  }
  return parsed.data;
}

function isoOf(stamp: string | null | undefined): string | null {
  if (stamp === undefined || stamp === null || stamp.trim() === "") return null;
  const parsed = Date.parse(stamp);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

interface Leaf {
  id: string;
  name: string;
  group: string | null;
  status: OverallStatus;
}

/**
 * The components an operator can pick, which are the leaves: a group's status is
 * a summary of the rows under it, so listing both would offer the same reading
 * twice and fold it twice. A group with nothing under it is a leaf itself.
 */
function leavesOf(components: z.infer<typeof componentSchema>[], group: string | null = null): Leaf[] {
  return components.flatMap((component) => {
    const children = (component.subcomponents ?? []) as z.infer<typeof componentSchema>[];
    if (children.length > 0) return leavesOf(children, component.name ?? null);
    if (component.id === undefined) return [];
    return [
      {
        id: String(component.id),
        name: component.name ?? "",
        group,
        status: mapStatus(component.status),
      },
    ];
  });
}

/** Severity worst last. `unknown` is absent: it ranks nowhere, it only abstains. */
const SEVERITY: OverallStatus[] = ["operational", "degraded", "partial_outage", "major_outage"];

function worstOf(components: { status: OverallStatus }[]): OverallStatus {
  const worst = components.reduce((rank, component) => Math.max(rank, SEVERITY.indexOf(component.status)), -1);
  return SEVERITY[worst] ?? "unknown";
}

/**
 * Scoping only bites once something is selected: an operator who asks for it and
 * then picks nothing must keep seeing the whole page, not go silent.
 */
function scopeOf(service: ServiceRef): Set<string> | null {
  const selection = service.components ?? [];
  if (service.scopeToComponents !== true || selection.length === 0) return null;
  return new Set(selection.map((component) => component.id));
}

/** The updates in the order they were posted, newest last. */
function updatesOf(incident: z.infer<typeof incidentSchema>): { at: string; state: string }[] {
  return incident.updates
    .flatMap((update) => {
      const at = isoOf(update.updated_at);
      return at === null ? [] : [{ at, state: update.incident_state ?? "" }];
    })
    .sort((left, right) => left.at.localeCompare(right.at));
}

/** When anything last happened on an incident: its newest update, or its start. */
function updatedAtOf(incident: z.infer<typeof incidentSchema>, fallback: string): string {
  const posted = updatesOf(incident);
  return posted[posted.length - 1]?.at ?? isoOf(incident.starts_at) ?? fallback;
}

/**
 * Where the incident stands. The page publishes the answer twice — as a field on
 * the incident and as the state of its newest update — and only one of the two
 * is filled in on a given endpoint, so both are read.
 */
function stateOf(incident: z.infer<typeof incidentSchema>): string {
  const posted = updatesOf(incident);
  return incident.latest_update_incident_state ?? posted[posted.length - 1]?.state ?? "";
}

function windowOf(incident: z.infer<typeof incidentSchema>): MaintenanceWindow[] {
  const id = incident.id;
  const startsAt = isoOf(incident.starts_at);
  // A window with no id cannot be told from the next one, and one we cannot
  // place on a clock cannot silence anything.
  if (id === undefined || startsAt === null) return [];
  return [
    {
      id: String(id),
      name: incident.name ?? "",
      status: stateOf(incident),
      startsAt,
      endsAt: isoOf(incident.ends_at),
      componentIds: incident.affected_components
        .filter((component) => component.id !== undefined)
        .map((component) => String(component.id)),
    },
  ];
}

/** Pure mapping from an `/ajax` body to a reading, exported for the tests. */
export function parseUptimeComStatus(raw: string, service: ServiceRef): NormalizedStatus {
  const page = parseBody(raw, ajaxSchema, service, "status").data;
  const fetchedAt = new Date().toISOString();
  const scope = scopeOf(service);

  const leaves = leavesOf(page?.components ?? []);
  const listed = new Map(leaves.map((leaf) => [leaf.id, leaf]));

  const open = (page?.active_incidents ?? []).filter((incident) => incident.incident_type !== MAINTENANCE_TYPE);
  const activeIncidents: Incident[] = open
    .filter((incident) => incident.id !== undefined)
    .filter(
      // An incident attributed to nothing is a page-wide announcement and never
      // out of scope: dropping it would hide the provider's own global notices.
      (incident) =>
        scope === null ||
        incident.affected_components.length === 0 ||
        incident.affected_components.some((component) => scope.has(String(component.id))),
    )
    .map((incident) => ({
      id: String(incident.id),
      name: incident.name ?? "",
      // The provider's own word for both fields, unnormalised, so a notifier can
      // quote Uptime.com rather than us.
      impact: stateOf(incident),
      status: stateOf(incident),
      updatedAt: updatedAtOf(incident, fetchedAt),
    }));

  const components: ComponentStatus[] = (service.components ?? []).map((selection) => ({
    id: selection.id,
    // The provider's current name wins; the stored one is the fallback for a
    // component the page has since dropped or renamed away.
    name: listed.get(selection.id)?.name ?? selection.name,
    // A selection the page no longer lists reads `unknown`, never operational.
    status: listed.get(selection.id)?.status ?? "unknown",
  }));

  // A declared window arrives either as an upcoming one or, once it has started,
  // as an active incident typed as maintenance.
  const maintenances: MaintenanceWindow[] = [
    ...(page?.upcoming_maintenance ?? []),
    ...(page?.active_incidents ?? []).filter((incident) => incident.incident_type === MAINTENANCE_TYPE),
  ].flatMap(windowOf);

  // The page's own flag decides when nothing is selected: it is the word the
  // operator sees at the top of it, and a page can carry an incident that has
  // not moved a component. It only ever *raises* the reading — an operational
  // flag over a degraded component reads degraded.
  const folded = worstOf(leaves);
  const overallStatus =
    scope !== null
      ? worstOf(components)
      : page?.global_is_operational === false && folded === "operational"
        ? "degraded"
        : folded;

  return { provider: service.id, overallStatus, activeIncidents, components, maintenances, fetchedAt };
}

/**
 * Pure mapping from a `/history` body to the incident timeline, exported for the
 * tests. Maintenance is left out: this is the incident history, and a planned
 * window is not an incident.
 */
export function parseUptimeComHistory(raw: string, service: ServiceRef): IncidentHistoryResult {
  const page = parseBody(raw, historySchema, service, "history").data;
  const fetchedAt = new Date().toISOString();

  const incidents: HistoricalIncident[] = [...(page?.past_incidents ?? []), ...(page?.active_incidents ?? [])]
    .filter((incident) => incident.incident_type !== MAINTENANCE_TYPE)
    .flatMap((incident) => {
      const id = incident.id;
      const startedAt = isoOf(incident.starts_at);
      // An incident we cannot place on a clock cannot go on a timeline.
      if (id === undefined || startedAt === null) return [];
      const state = stateOf(incident);
      const endsAt = isoOf(incident.ends_at);
      return [
        {
          id: String(id),
          name: incident.name ?? "",
          impact: state,
          status: state,
          startedAt,
          // A page writes `ends_at` on a closed incident and leaves it null on
          // an open one, so the timestamp is the closure rather than the state.
          resolvedAt: state.toLowerCase() === RESOLVED ? (endsAt ?? updatedAtOf(incident, fetchedAt)) : endsAt,
          updatedAt: updatedAtOf(incident, fetchedAt),
        },
      ];
    });

  const oldest = incidents.reduce<string | null>(
    (min, incident) => (min === null || incident.startedAt < min ? incident.startedAt : min),
    null,
  );

  // Never null: `/history` serves the window the page is configured to show, and
  // what falls outside it is exactly what this cannot account for.
  return { incidents, coverageStart: oldest };
}

/** Pure mapping from an `/ajax` body to the picker's rows, exported for the tests. */
export function parseUptimeComComponents(raw: string, service: ServiceRef): ComponentPreview[] {
  const page = parseBody(raw, ajaxSchema, service, "status").data;
  return leavesOf(page?.components ?? []).map((leaf) => ({
    id: leaf.id,
    name: leaf.name,
    group: leaf.group,
    // Uptime.com publishes no "featured" flag; the picker's hint simply has
    // nothing to go on here.
    showcase: false,
    status: leaf.status,
  }));
}

async function readJson(path: string, service: ServiceRef, ctx: FetchContext): Promise<string> {
  return fetchConditional(`${service.baseUrl.replace(/\/+$/, "")}${path}`, {
    // The cache is keyed by provider *and* url, so the two paths under one id
    // are two entries — and `forgetProvider` still drops both at once.
    providerId: service.id,
    accept: "application/json",
    timeoutMs: ctx.timeoutMs,
    onRead: ctx.onRead,
    label: "uptimecom fetch",
  });
}

export const uptimeComAdapter: Adapter = {
  id: "uptimecom",

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    return parseUptimeComStatus(await readJson(AJAX_PATH, service, ctx), service);
  },

  async fetchIncidentHistory(service: ServiceRef, ctx: FetchContext): Promise<IncidentHistoryResult> {
    return parseUptimeComHistory(await readJson(HISTORY_PATH, service, ctx), service);
  },

  async listComponents(service: ServiceRef, ctx: FetchContext): Promise<ComponentPreview[]> {
    return parseUptimeComComponents(await readJson(AJAX_PATH, service, ctx), service);
  },
};
