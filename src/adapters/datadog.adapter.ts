import { z } from "zod";
import type {
  Adapter,
  ComponentPreview,
  FetchContext,
  IncidentHistoryResult,
  IncidentUpdate,
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
import { createdAtOf } from "./createdAt.ts";
import { worstStatus } from "./severity.ts";

/**
 * Datadog Status Pages — the status-page product Datadog launched in 2026, and
 * the one Datadog's own page and DNSimple's moved to off Atlassian Statuspage.
 *
 * The page is a static single-page app; everything it renders comes from one
 * public, unauthenticated document beside it, `/config.json`, which holds the
 * component tree, every incident the page has ever published (open and
 * resolved, each with its timeline) and every maintenance window. So one read
 * answers the reading, the component picker, the history backfill and an
 * incident's updates alike. `service.baseUrl` is the page itself
 * (`https://status.datadoghq.com`), custom domain or `*.statuspage.datadoghq.com`.
 *
 * The page publishes no page-wide indicator: the reading is folded from the
 * components' own states, with any open incident as a floor of `degraded` — a
 * page that says something is wrong while every component still reads green
 * is still saying something is wrong.
 */

const CONFIG_PATH = "/config.json";

/** One component as `/config.json` lists it; a `ComponentGroup` nests more. */
interface RawComponent {
  id?: string | undefined;
  name?: string | undefined;
  status?: string | undefined;
  type?: string | undefined;
  components?: RawComponent[] | null | undefined;
}

const componentSchema: z.ZodType<RawComponent> = z.lazy(() =>
  z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    status: z.string().optional(),
    type: z.string().optional(),
    components: z.array(componentSchema).nullable().optional(),
  }),
);

const affectedSchema = z.array(z.object({ id: z.string().optional(), status: z.string().optional() })).nullable().optional();

const incidentSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  currentStatus: z.string().optional(),
  resolved: z.boolean().nullable().optional(),
  publishedDate: z.string().nullable().optional(),
  resolvedDate: z.string().nullable().optional(),
  lastModifiedAt: z.string().nullable().optional(),
  componentsAffected: affectedSchema,
  timeline: z
    .array(
      z.object({
        status: z.string().optional(),
        description: z.string().nullable().optional(),
        startedAt: z.string().nullable().optional(),
        createdAt: z.string().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
});

const maintenanceSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  currentStatus: z.string().optional(),
  startDate: z.string().nullable().optional(),
  completedDate: z.string().nullable().optional(),
  componentsAffected: affectedSchema,
});

/**
 * `components` is the one key every page has — it is what the page draws — so
 * it is what tells this document apart from any other JSON that happens to
 * live at `/config.json`. Datadog's own page publishes `maintenances: null`.
 */
const configSchema = z.object({
  components: z.array(componentSchema),
  incidents: z.array(incidentSchema).nullable().optional(),
  maintenances: z.array(maintenanceSchema).nullable().optional(),
});

type Config = z.infer<typeof configSchema>;

/**
 * Component states, the same words an incident's affected components carry.
 * `maintenance` maps to `unknown` for the reason Statuspage's
 * `under_maintenance` does: the model has no maintenance state, and `unknown`
 * abstains in the diff engine rather than reading as a recovery.
 */
const STATES: Record<string, OverallStatus> = {
  operational: "operational",
  degraded: "degraded",
  partial_outage: "partial_outage",
  major_outage: "major_outage",
  maintenance: "unknown",
};

/** A word nobody has seen reads as the worst case: an outage silently read as green is the failure that matters. */
function stateOf(word: string | undefined): OverallStatus {
  if (word === undefined || word === "") return "unknown";
  return STATES[word] ?? "major_outage";
}

const CLOSED_INCIDENT = new Set(["resolved"]);
const CLOSED_MAINTENANCE = new Set(["completed", "canceled", "cancelled"]);

/** Throws when the body is not this platform's document — the poller's retry accounting depends on it. */
export function parseDatadogConfig(raw: string, service: ServiceRef): Config {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`datadog fetch for ${service.id} returned a body that is not JSON`);
  }
  const parsed = configSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`datadog fetch for ${service.id} returned a body that is not a Datadog status page config`);
  }
  return parsed.data;
}

/** Leaf components with the group each sits in, groups themselves left out. */
function leaves(components: RawComponent[], group: string | null = null): { component: RawComponent; group: string | null }[] {
  return components.flatMap((component) =>
    component.type === "ComponentGroup" || (component.components ?? []).length > 0
      ? leaves(component.components ?? [], component.name ?? group)
      : [{ component, group }],
  );
}

const isOpen = (incident: z.infer<typeof incidentSchema>): boolean =>
  incident.resolved !== true && !CLOSED_INCIDENT.has(incident.currentStatus ?? "");

/** The worst word an incident's affected components carry, as the provider wrote it. */
function impactOf(affected: { status?: string | undefined }[] | null | undefined): string {
  const words = (affected ?? []).flatMap((entry) => (entry.status === undefined ? [] : [entry.status]));
  if (words.length === 0) return "";
  const worst = worstStatus(words.map(stateOf).filter((status) => status !== "unknown"));
  return words.find((word) => stateOf(word) === worst) ?? words[0]!;
}

/** The selected component ids, or null when the provider is not scoped. */
function scopeOf(service: ServiceRef): Set<string> | null {
  const selection = service.components ?? [];
  if (service.scopeToComponents !== true || selection.length === 0) return null;
  return new Set(selection.map((component) => component.id));
}

/**
 * An incident is out of scope only when it names its components and none is
 * selected. One that names none is page-wide and always stays — the same rule
 * the Statuspage adapter applies.
 */
function outOfScope(affected: { id?: string | undefined }[] | null | undefined, scope: Set<string>): boolean {
  const ids = (affected ?? []).flatMap((entry) => (entry.id === undefined ? [] : [entry.id]));
  return ids.length > 0 && !ids.some((id) => scope.has(id));
}

const toIso = (stamp: string | null | undefined): string | null => {
  if (stamp == null) return null;
  const ms = Date.parse(stamp);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};

/** Pure mapping from a `/config.json` body to a reading, exported for the tests. */
export function parseDatadogStatus(raw: string, service: ServiceRef): NormalizedStatus {
  const config = parseDatadogConfig(raw, service);
  const fetchedAt = new Date().toISOString();
  const scope = scopeOf(service);

  const listed = new Map(
    leaves(config.components).flatMap(({ component }) => (component.id === undefined ? [] : [[component.id, component] as const])),
  );
  const components: ComponentStatus[] = (service.components ?? []).map((selection) => {
    const found = listed.get(selection.id);
    // A selection the page no longer lists reads `unknown`, never operational.
    return { id: selection.id, name: found?.name ?? selection.name, status: found === undefined ? "unknown" : stateOf(found.status) };
  });

  const open = (config.incidents ?? []).filter(
    (incident) => incident.id !== undefined && isOpen(incident) && (scope === null || !outOfScope(incident.componentsAffected, scope)),
  );
  const activeIncidents: Incident[] = open.map((incident) => ({
    id: incident.id as string,
    name: incident.title ?? "",
    impact: impactOf(incident.componentsAffected),
    status: incident.currentStatus ?? "",
    updatedAt: incident.lastModifiedAt ?? incident.publishedDate ?? fetchedAt,
    ...createdAtOf(incident.publishedDate),
  }));

  // As with Statuspage, a window is kept on a scoped provider too: the page is
  // telling us part of it is under work, and `componentIds` says which part.
  const maintenances: MaintenanceWindow[] = (config.maintenances ?? []).flatMap((entry) => {
    const startsAt = toIso(entry.startDate);
    // No id, no telling it from the next window; no start, nothing to place on a clock.
    if (entry.id === undefined || startsAt === null) return [];
    if (CLOSED_MAINTENANCE.has(entry.currentStatus ?? "")) return [];
    return [
      {
        id: entry.id,
        name: entry.title ?? "",
        status: entry.currentStatus ?? "",
        startsAt,
        endsAt: toIso(entry.completedDate),
        componentIds: (entry.componentsAffected ?? []).flatMap((component) => (component.id === undefined ? [] : [component.id])),
      },
    ];
  });

  const states =
    scope === null ? [...listed.values()].map((component) => stateOf(component.status)) : components.map((component) => component.status);
  const known = states.filter((status) => status !== "unknown");
  const folded: OverallStatus = known.length === 0 ? "unknown" : worstStatus(known);
  // An open incident is trouble even when no component has been marked yet.
  const overallStatus: OverallStatus =
    activeIncidents.length > 0 && (folded === "operational" || folded === "unknown") ? "degraded" : folded;

  return { provider: service.id, overallStatus, activeIncidents, components, maintenances, fetchedAt };
}

/** Pure mapping from a `/config.json` body to the picker's rows, exported for the tests. */
export function parseDatadogComponents(raw: string, service: ServiceRef): ComponentPreview[] {
  return leaves(parseDatadogConfig(raw, service).components).flatMap(({ component, group }) =>
    component.id === undefined
      ? []
      : [{ id: component.id, name: component.name ?? "", group, showcase: false, status: stateOf(component.status) }],
  );
}

/**
 * Every incident the page holds, exported for the tests. The document carries
 * the page's whole history, so coverage reaches back to its oldest incident —
 * stated as that date rather than null, since nothing says the page never
 * trims what it keeps.
 */
export function parseDatadogHistory(raw: string, service: ServiceRef): IncidentHistoryResult {
  const scope = scopeOf(service);
  const incidents: HistoricalIncident[] = (parseDatadogConfig(raw, service).incidents ?? []).flatMap((incident) => {
    const startedAt = toIso(incident.publishedDate);
    if (incident.id === undefined || startedAt === null) return [];
    if (scope !== null && outOfScope(incident.componentsAffected, scope)) return [];
    const resolvedAt = isOpen(incident) ? null : (toIso(incident.resolvedDate) ?? toIso(incident.lastModifiedAt) ?? startedAt);
    return [
      {
        id: incident.id,
        name: incident.title ?? "",
        impact: impactOf(incident.componentsAffected),
        status: incident.currentStatus ?? "",
        startedAt,
        resolvedAt,
        updatedAt: toIso(incident.lastModifiedAt) ?? resolvedAt ?? startedAt,
      },
    ];
  });
  const oldest = incidents.reduce<string | null>((min, incident) => (min === null || incident.startedAt < min ? incident.startedAt : min), null);
  return { incidents, coverageStart: oldest };
}

/** One incident's timeline, oldest first, exported for the tests. Unknown id: no updates. */
export function parseDatadogUpdates(raw: string, incidentId: string, service: ServiceRef): IncidentUpdate[] {
  const incident = (parseDatadogConfig(raw, service).incidents ?? []).find((entry) => entry.id === incidentId);
  return (incident?.timeline ?? [])
    .flatMap((entry) => {
      const at = toIso(entry.startedAt) ?? toIso(entry.createdAt);
      return at === null ? [] : [{ at, status: entry.status ?? "", body: entry.description ?? "" }];
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}

async function readConfig(service: ServiceRef, ctx: FetchContext): Promise<string> {
  return fetchConditional(`${service.baseUrl}${CONFIG_PATH}`, {
    providerId: service.id,
    // The page serves it as text/plain; asking for JSON is still what we mean.
    accept: "application/json, text/plain",
    timeoutMs: ctx.timeoutMs,
    onRead: ctx.onRead,
    auth: service.options,
    label: "datadog fetch",
  });
}

export const datadogAdapter: Adapter = {
  id: "datadog",
  version: 1,

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    return parseDatadogStatus(await readConfig(service, ctx), service);
  },

  async listComponents(service: ServiceRef, ctx: FetchContext): Promise<ComponentPreview[]> {
    return parseDatadogComponents(await readConfig(service, ctx), service);
  },

  async fetchIncidentHistory(service: ServiceRef, ctx: FetchContext): Promise<IncidentHistoryResult> {
    return parseDatadogHistory(await readConfig(service, ctx), service);
  },

  async fetchIncidentUpdates(service: ServiceRef, incidentId: string, ctx: FetchContext): Promise<IncidentUpdate[]> {
    return parseDatadogUpdates(await readConfig(service, ctx), incidentId, service);
  },
};
