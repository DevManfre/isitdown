import { z } from "zod";
import type {
  Adapter,
  ComponentPreview,
  FetchContext,
  IncidentHistoryResult,
  ServiceRef,
} from "../core/adapter.interface.ts";
import type { ComponentStatus, HistoricalIncident, Incident, NormalizedStatus, OverallStatus } from "../core/types.ts";

/**
 * The generic adapter for Atlassian Statuspage, which most providers run on —
 * GitHub, Cloudflare and Claude among them. It is configured by base URL alone,
 * so adding such a provider needs no code.
 */

const SUMMARY_PATH = "/api/v2/summary.json";
const INCIDENTS_PATH = "/api/v2/incidents.json";

/** The public API returns at most this many incidents, newest first, unpaginated. */
const FEED_CAP = 50;

/**
 * The components an incident is attributed to. Only the ids matter here, and an
 * unreadable list degrades to "no attribution" rather than throwing: an incident
 * whose attribution cannot be read must still be reported, never swallowed.
 */
const attributionSchema = z
  .array(z.object({ id: z.string().optional() }))
  .optional()
  .catch(undefined);

/** One entry in Statuspage's `components` array — a component or a group. */
const componentSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  status: z.string().optional(),
  group: z.boolean().optional(),
  group_id: z.string().nullable().optional(),
  showcase: z.boolean().optional(),
});

/**
 * Deliberately lenient: individual fields are optional because a provider that
 * drops one must degrade, not crash the cycle. The shape as a whole is still
 * checked, so a login page or an error blob is rejected loudly.
 */
const summarySchema = z.object({
  status: z.object({ indicator: z.string().optional() }).optional(),
  incidents: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().optional(),
        impact: z.string().optional(),
        status: z.string().optional(),
        updated_at: z.string().optional(),
        created_at: z.string().optional(),
        components: attributionSchema,
      }),
    )
    .optional(),
  // .catch() rather than a bare .optional(): a provider sending a malformed
  // components list (wrong shape entirely) must degrade to "no components
  // reported this cycle", not throw and drop the whole poll.
  components: z.array(componentSchema).optional().catch(undefined),
});

const historySchema = z.object({
  incidents: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string().optional(),
      impact: z.string().optional(),
      status: z.string().optional(),
      created_at: z.string().optional(),
      updated_at: z.string().optional(),
      resolved_at: z.string().nullable().optional(),
      components: attributionSchema,
    }),
  ),
});

const INDICATORS: Record<string, OverallStatus> = {
  none: "operational",
  minor: "degraded",
  major: "partial_outage",
  critical: "major_outage",
};

/** Statuspage lifecycle words that mean the incident is over. */
const CLOSED_STATUSES = new Set(["resolved", "postmortem"]);

function mapIndicator(indicator: string | undefined): OverallStatus {
  if (indicator === undefined) return "unknown";
  // An indicator we have never seen is treated as the worst case: silently
  // downgrading an outage to operational is the one failure mode that matters.
  return INDICATORS[indicator] ?? "major_outage";
}

/**
 * Statuspage's per-component vocabulary. `under_maintenance` maps to `unknown`
 * deliberately: the normalized model has no maintenance state, and `unknown` is
 * not comparable in the diff engine, so a maintenance window stays silent.
 */
const COMPONENT_STATUSES: Record<string, OverallStatus> = {
  operational: "operational",
  degraded_performance: "degraded",
  partial_outage: "partial_outage",
  major_outage: "major_outage",
  under_maintenance: "unknown",
};

function mapComponentStatus(status: string | undefined): OverallStatus {
  if (status === undefined) return "unknown";
  return COMPONENT_STATUSES[status] ?? "major_outage";
}

/** Severity worst last. `unknown` is absent: it ranks nowhere, it only abstains. */
const SEVERITY: OverallStatus[] = ["operational", "degraded", "partial_outage", "major_outage"];

/**
 * How a scoped provider reads its selection: the worst status any selected
 * component reports, and `unknown` when none of them reports one at all. Never
 * optimistic — a selection the provider has dropped must not read as a recovery.
 */
function worstOf(components: ComponentStatus[]): OverallStatus {
  const worst = components.reduce((rank, component) => Math.max(rank, SEVERITY.indexOf(component.status)), -1);
  return SEVERITY[worst] ?? "unknown";
}

/**
 * Whether a scoped provider should ignore this incident. An incident with no
 * component attribution is a page-wide announcement and never out of scope:
 * dropping it would hide the provider's own global notices.
 */
function outOfScope(attributed: { id?: string | undefined }[] | undefined, selected: Set<string>): boolean {
  if (attributed === undefined || attributed.length === 0) return false;
  return !attributed.some((component) => component.id !== undefined && selected.has(component.id));
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

/**
 * Pure mapping from a summary payload to the internal shape, exported so the
 * fixture suite can exercise it without any network.
 *
 * Throws when the body is not a Statuspage summary at all — the poller's retry
 * and failure accounting depend on that. Scheduled maintenances are ignored:
 * the normalised model has no maintenance state.
 */
export function parseSummary(raw: unknown, service: ServiceRef): NormalizedStatus {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`statuspage summary for ${service.id} is not an object`);
  }
  const parsed = summarySchema.parse(raw);
  if (parsed.status === undefined && parsed.incidents === undefined) {
    throw new Error(`statuspage summary for ${service.id} has neither status nor incidents`);
  }

  const fetchedAt = new Date().toISOString();
  const scope = scopeOf(service);
  const activeIncidents: Incident[] = (parsed.incidents ?? []).flatMap((incident) => {
    const id = incident.id;
    if (id === undefined) return [];
    if (CLOSED_STATUSES.has(incident.status ?? "")) return [];
    if (scope !== null && outOfScope(incident.components, scope)) return [];
    return [
      {
        id,
        name: incident.name ?? "",
        impact: incident.impact ?? "",
        status: incident.status ?? "",
        updatedAt: incident.updated_at ?? incident.created_at ?? fetchedAt,
      },
    ];
  });

  const byId = new Map(
    (parsed.components ?? [])
      .filter((component) => component.id !== undefined && component.group !== true)
      .map((component) => [component.id as string, component]),
  );
  // Selection order, payload name when present, `unknown` when the provider no
  // longer exposes the component — never a false transition, never a crash.
  const components: ComponentStatus[] = (service.components ?? []).map(({ id, name }) => {
    const found = byId.get(id);
    return {
      id,
      name: found?.name ?? name,
      status: found === undefined ? "unknown" : mapComponentStatus(found.status),
    };
  });

  return {
    provider: service.id,
    overallStatus: scope === null ? mapIndicator(parsed.status?.indicator) : worstOf(components),
    activeIncidents,
    components,
    fetchedAt,
  };
}

/**
 * Pure mapping from an incidents.json payload, exported for the fixture suite.
 * Throws when the body is not a Statuspage incident list at all. An entry
 * without an id or a start time cannot be placed on a timeline and is dropped.
 */
export function parseIncidentHistory(raw: unknown, service: ServiceRef): IncidentHistoryResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`statuspage incident history for ${service.id} is not an object`);
  }
  const parsed = historySchema.parse(raw);

  const scope = scopeOf(service);
  const incidents: HistoricalIncident[] = parsed.incidents.flatMap((incident) => {
    const id = incident.id;
    const createdAt = incident.created_at;
    if (id === undefined || createdAt === undefined) return [];
    if (scope !== null && outOfScope(incident.components, scope)) return [];
    const closed = CLOSED_STATUSES.has(incident.status ?? "");
    return [
      {
        id,
        name: incident.name ?? "",
        impact: incident.impact ?? "",
        status: incident.status ?? "",
        startedAt: createdAt,
        // A closed incident missing resolved_at still ended; its last update is
        // the best end time available, and null would read as "still open".
        resolvedAt: incident.resolved_at ?? (closed ? (incident.updated_at ?? createdAt) : null),
        updatedAt: incident.updated_at ?? createdAt,
      },
    ];
  });

  const oldest = incidents.reduce<string | null>(
    (min, incident) => (min === null || incident.startedAt < min ? incident.startedAt : min),
    null,
  );
  return {
    incidents,
    // A full feed proves nothing about what rolled off before its oldest entry.
    coverageStart: parsed.incidents.length >= FEED_CAP ? oldest : null,
  };
}

/** Pure mapping for the picker, exported for the fixture suite. */
export function parseComponentList(raw: unknown, service: ServiceRef): ComponentPreview[] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`statuspage summary for ${service.id} is not an object`);
  }
  const parsed = summarySchema.parse(raw);
  const rows = parsed.components ?? [];
  const groupNames = new Map(
    rows
      .filter((row) => row.group === true && row.id !== undefined)
      .map((row) => [row.id as string, row.name ?? ""]),
  );
  return rows
    .filter((row) => row.group !== true && row.id !== undefined)
    .map((row) => ({
      id: row.id as string,
      name: row.name ?? "",
      group: row.group_id == null ? null : (groupNames.get(row.group_id) ?? null),
      showcase: row.showcase ?? false,
    }));
}

export const statuspageAdapter: Adapter = {
  id: "statuspage",

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    const url = `${service.baseUrl}${SUMMARY_PATH}`;
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`statuspage fetch for ${service.id} failed: HTTP ${response.status}`);
    }
    return parseSummary(await response.json(), service);
  },

  async fetchIncidentHistory(service: ServiceRef, ctx: FetchContext): Promise<IncidentHistoryResult> {
    const url = `${service.baseUrl}${INCIDENTS_PATH}`;
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`statuspage incident history for ${service.id} failed: HTTP ${response.status}`);
    }
    return parseIncidentHistory(await response.json(), service);
  },

  async listComponents(service: ServiceRef, ctx: FetchContext): Promise<ComponentPreview[]> {
    const url = `${service.baseUrl}${SUMMARY_PATH}`;
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`statuspage components fetch for ${service.id} failed: HTTP ${response.status}`);
    }
    return parseComponentList(await response.json(), service);
  },
};
