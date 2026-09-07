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
 * Better Stack status pages (roadmap 1.7).
 *
 * One public endpoint, `/index.json`, and it carries the whole page: the
 * aggregate state, every resource (Better Stack's word for a component) with
 * its own status, every report — theirs for both incidents and scheduled
 * maintenance — and every update posted on those reports. `service.baseUrl` is
 * the page's host (`https://status.betterstack.com`).
 *
 * That one document is why this adapter supports more than Instatus's does with
 * two: components, component scoping and the incident timeline all come out of
 * the same read, so none of them costs an extra request.
 *
 * The shape is JSON:API-flavoured — `data` for the page, `included` for
 * everything else, keyed by `type` — and a report links its updates through
 * `relationships`, which is where an incident's "last updated" comes from: the
 * report itself carries only when it started.
 */

const INDEX_PATH = "/index.json";

const historyDaySchema = z.object({
  day: z.string().optional(),
  status: z.string().optional(),
});

const resourceSchema = z.object({
  public_name: z.string().optional(),
  status: z.string().optional(),
  status_page_section_id: z.union([z.number(), z.string()]).optional(),
  status_history: z.array(historyDaySchema).optional(),
});

const sectionSchema = z.object({
  name: z.string().optional(),
});

const affectedSchema = z.object({
  status_page_resource_id: z.union([z.number(), z.string()]).optional(),
  status: z.string().optional(),
});

const reportSchema = z.object({
  title: z.string().optional(),
  /** `manual` for an incident, `maintenance` for a declared window. */
  report_type: z.string().optional(),
  starts_at: z.string().optional(),
  ends_at: z.string().nullable().optional(),
  aggregate_state: z.string().optional(),
  affected_resources: z.array(affectedSchema).default([]),
});

const updateSchema = z.object({
  published_at: z.string().optional(),
});

const relationshipsSchema = z
  .object({
    status_updates: z
      .object({ data: z.array(z.object({ id: z.union([z.number(), z.string()]) })).default([]) })
      .optional(),
  })
  .optional();

const includedSchema = z.object({
  id: z.union([z.number(), z.string()]),
  type: z.string(),
  attributes: z.unknown().optional(),
  relationships: relationshipsSchema,
});

const indexSchema = z.object({
  data: z
    .object({
      attributes: z.object({ aggregate_state: z.string().optional() }).optional(),
    })
    .optional(),
  included: z.array(includedSchema).default([]),
});

/**
 * Better Stack's own vocabulary, shared by the aggregate state, a resource's
 * status and a report's. `maintenance` and `not_monitored` map to `unknown`:
 * the normalized model has no state for either, and `unknown` abstains in the
 * diff engine rather than reading as a recovery.
 */
const STATES: Record<string, OverallStatus> = {
  operational: "operational",
  degraded: "degraded",
  downtime: "major_outage",
  maintenance: "unknown",
  not_monitored: "unknown",
};

/** A report in this state is over; only its history is interesting. */
const RESOLVED = "resolved";

const MAINTENANCE_REPORT = "maintenance";

/**
 * A word we have never seen is treated as the worst case, as in the Statuspage
 * and Instatus adapters: silently downgrading an outage to operational is the
 * one failure mode that matters.
 */
function mapState(word: string | undefined): OverallStatus {
  if (word === undefined || word === "") return "unknown";
  return STATES[word.toLowerCase()] ?? "major_outage";
}

/** Throws when the body is not this provider's payload — the poller's retry accounting depends on it. */
function parseIndex(raw: string, service: ServiceRef): z.infer<typeof indexSchema> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`betterstack fetch for ${service.id} returned a body that is not JSON`);
  }
  const parsed = indexSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`betterstack fetch for ${service.id} returned a body that is not a status-page payload`);
  }
  return parsed.data;
}

interface Report {
  id: string;
  title: string;
  type: string;
  state: string;
  startsAt: string;
  endsAt: string | null;
  /** When the newest update on it was posted, or its start if it has none. */
  updatedAt: string;
  resourceIds: string[];
}

interface Page {
  aggregate: OverallStatus;
  resources: { id: string; name: string; group: string | null; status: OverallStatus }[];
  reports: Report[];
}

/** Everything the one document says, in this codebase's own terms. */
function readPage(raw: string, service: ServiceRef): Page {
  const parsed = parseIndex(raw, service);

  const sections = new Map<string, string>();
  const updatedAt = new Map<string, string>();
  for (const entry of parsed.included) {
    if (entry.type === "status_page_section") {
      const attributes = sectionSchema.safeParse(entry.attributes);
      if (attributes.success) sections.set(String(entry.id), attributes.data.name ?? "");
    }
    if (entry.type === "status_update") {
      const attributes = updateSchema.safeParse(entry.attributes);
      if (attributes.success && attributes.data.published_at !== undefined) {
        updatedAt.set(String(entry.id), attributes.data.published_at);
      }
    }
  }

  const resources: Page["resources"] = [];
  const reports: Report[] = [];
  for (const entry of parsed.included) {
    if (entry.type === "status_page_resource") {
      const attributes = resourceSchema.safeParse(entry.attributes);
      if (!attributes.success) continue;
      const section = attributes.data.status_page_section_id;
      resources.push({
        id: String(entry.id),
        name: attributes.data.public_name ?? "",
        group: section === undefined ? null : (sections.get(String(section)) ?? null),
        status: mapState(attributes.data.status),
      });
    }
    if (entry.type === "status_report") {
      const attributes = reportSchema.safeParse(entry.attributes);
      if (!attributes.success) continue;
      const startsAt = attributes.data.starts_at;
      // A report we cannot place on a clock can be neither an incident on a
      // timeline nor a window that silences one.
      if (startsAt === undefined || Number.isNaN(Date.parse(startsAt))) continue;
      // The report says when it started; only its updates say when anything
      // last happened on it, so the newest of those is the report's own.
      const posted = (entry.relationships?.status_updates?.data ?? [])
        .map((link) => updatedAt.get(String(link.id)))
        .filter((at): at is string => at !== undefined)
        .sort();
      reports.push({
        id: String(entry.id),
        title: attributes.data.title ?? "",
        type: attributes.data.report_type ?? "",
        state: attributes.data.aggregate_state ?? "",
        startsAt,
        endsAt: attributes.data.ends_at ?? null,
        updatedAt: posted[posted.length - 1] ?? startsAt,
        resourceIds: attributes.data.affected_resources
          .map((affected) => affected.status_page_resource_id)
          .filter((id): id is string | number => id !== undefined)
          .map(String),
      });
    }
  }

  return { aggregate: mapState(parsed.data?.attributes?.aggregate_state), resources, reports };
}

/**
 * Scoping only bites once something is selected: an operator who asks for it
 * and then picks nothing must keep seeing the whole page, not go silent.
 */
function scopeOf(service: ServiceRef): Set<string> | null {
  const selection = service.components ?? [];
  if (service.scopeToComponents !== true || selection.length === 0) return null;
  return new Set(selection.map((component) => component.id));
}

/** Severity worst last. `unknown` is absent: it ranks nowhere, it only abstains. */
const SEVERITY: OverallStatus[] = ["operational", "degraded", "partial_outage", "major_outage"];

function worstOf(components: ComponentStatus[]): OverallStatus {
  const worst = components.reduce((rank, component) => Math.max(rank, SEVERITY.indexOf(component.status)), -1);
  return SEVERITY[worst] ?? "unknown";
}

/** Pure mapping from an `/index.json` body to a reading, exported for the tests. */
export function parseBetterStackStatus(raw: string, service: ServiceRef): NormalizedStatus {
  const page = readPage(raw, service);
  const fetchedAt = new Date().toISOString();
  const scope = scopeOf(service);
  const listed = new Map(page.resources.map((resource) => [resource.id, resource]));

  const open = page.reports.filter(
    (report) => report.state !== RESOLVED && report.type !== MAINTENANCE_REPORT,
  );
  const activeIncidents: Incident[] = open
    .filter(
      // A report attributed to nothing is a page-wide announcement and never
      // out of scope: dropping it would hide the provider's own global notices.
      (report) =>
        scope === null ||
        report.resourceIds.length === 0 ||
        report.resourceIds.some((id) => scope.has(id)),
    )
    .map((report) => ({
      id: report.id,
      name: report.title,
      // Better Stack has one word for both, unnormalised, so a notifier can
      // quote the provider rather than us.
      impact: report.state,
      status: report.state,
      updatedAt: report.updatedAt,
    }));

  const components: ComponentStatus[] = (service.components ?? []).map((selection) => ({
    id: selection.id,
    // The provider's current name wins; the stored one is the fallback for a
    // resource the page has since dropped or renamed away.
    name: listed.get(selection.id)?.name ?? selection.name,
    // A selection the page no longer lists reads `unknown`, never operational.
    status: listed.get(selection.id)?.status ?? "unknown",
  }));

  const maintenances: MaintenanceWindow[] = page.reports
    .filter((report) => report.type === MAINTENANCE_REPORT && report.state !== RESOLVED)
    .map((report) => ({
      id: report.id,
      name: report.title,
      status: report.state,
      startsAt: new Date(Date.parse(report.startsAt)).toISOString(),
      endsAt: report.endsAt === null ? null : new Date(Date.parse(report.endsAt)).toISOString(),
      componentIds: report.resourceIds,
    }));

  return {
    provider: service.id,
    overallStatus: scope === null ? page.aggregate : worstOf(components),
    activeIncidents,
    components,
    maintenances,
    fetchedAt,
  };
}

/**
 * Pure mapping from the same body to the incident timeline, exported for the
 * tests. Maintenance reports are left out: this is the incident history, and a
 * planned window is not an incident.
 */
export function parseBetterStackHistory(raw: string, service: ServiceRef): IncidentHistoryResult {
  const page = readPage(raw, service);
  const incidents: HistoricalIncident[] = page.reports
    .filter((report) => report.type !== MAINTENANCE_REPORT)
    .map((report) => ({
      id: report.id,
      name: report.title,
      impact: report.state,
      status: report.state,
      startedAt: report.startsAt,
      // A resolved report often carries no `ends_at` at all — Better Stack
      // closes one by state, not by timestamp — so its newest update is the
      // only closure time the document offers.
      resolvedAt: report.state === RESOLVED ? (report.endsAt ?? report.updatedAt) : null,
      updatedAt: report.updatedAt,
    }));

  const oldest = incidents.reduce<string | null>(
    (min, incident) => (min === null || incident.startedAt < min ? incident.startedAt : min),
    null,
  );

  // Never null: `/index.json` carries the reports the page chooses to show, not
  // the provider's whole history, and what it left out is exactly what this
  // cannot account for.
  return { incidents, coverageStart: oldest };
}

/** Pure mapping from the same body to the picker's rows, exported for the tests. */
export function parseBetterStackComponents(raw: string, service: ServiceRef): ComponentPreview[] {
  return readPage(raw, service).resources.map((resource) => ({
    id: resource.id,
    name: resource.name,
    group: resource.group,
    // Better Stack publishes no "featured" flag; the picker's hint simply has
    // nothing to go on here.
    showcase: false,
    status: resource.status,
  }));
}

async function readJson(service: ServiceRef, ctx: FetchContext): Promise<string> {
  return fetchConditional(`${service.baseUrl}${INDEX_PATH}`, {
    providerId: service.id,
    accept: "application/json",
    timeoutMs: ctx.timeoutMs,
    onRead: ctx.onRead,
    label: "betterstack fetch",
  });
}

export const betterStackAdapter: Adapter = {
  id: "betterstack",

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    return parseBetterStackStatus(await readJson(service, ctx), service);
  },

  async fetchIncidentHistory(service: ServiceRef, ctx: FetchContext): Promise<IncidentHistoryResult> {
    return parseBetterStackHistory(await readJson(service, ctx), service);
  },

  async listComponents(service: ServiceRef, ctx: FetchContext): Promise<ComponentPreview[]> {
    return parseBetterStackComponents(await readJson(service, ctx), service);
  },
};
