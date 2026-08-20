import { z } from "zod";
import type { Adapter, FetchContext, IncidentHistoryResult, ServiceRef } from "../core/adapter.interface.ts";
import type { HistoricalIncident, Incident, NormalizedStatus, OverallStatus } from "../core/types.ts";

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
      }),
    )
    .optional(),
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
  const activeIncidents: Incident[] = (parsed.incidents ?? []).flatMap((incident) => {
    const id = incident.id;
    if (id === undefined) return [];
    if (CLOSED_STATUSES.has(incident.status ?? "")) return [];
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

  return {
    provider: service.id,
    overallStatus: mapIndicator(parsed.status?.indicator),
    activeIncidents,
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

  const incidents: HistoricalIncident[] = parsed.incidents.flatMap((incident) => {
    const id = incident.id;
    const createdAt = incident.created_at;
    if (id === undefined || createdAt === undefined) return [];
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
};
