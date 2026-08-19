import { z } from "zod";
import type { Adapter, FetchContext, ServiceRef } from "../core/adapter.interface.ts";
import type { Incident, NormalizedStatus, OverallStatus } from "../core/types.ts";

/**
 * The generic adapter for Atlassian Statuspage, which most providers run on —
 * GitHub, Cloudflare and Claude among them. It is configured by base URL alone,
 * so adding such a provider needs no code.
 */

const SUMMARY_PATH = "/api/v2/summary.json";

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
};
