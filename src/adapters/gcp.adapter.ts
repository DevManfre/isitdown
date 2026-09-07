import { z } from "zod";
import type { Adapter, FetchContext, IncidentHistoryResult, ServiceRef } from "../core/adapter.interface.ts";
import { fetchConditional } from "../core/http.ts";
import type { HistoricalIncident, Incident, NormalizedStatus, OverallStatus } from "../core/types.ts";
import { worstStatus } from "./severity.ts";

/**
 * Google Cloud publishes one flat incident list, `/incidents.json`, and no
 * overall status field: an incident with no `end` is open, and the provider's
 * status is whatever the open ones add up to. The same document is the history,
 * so `fetchStatus` and `fetchIncidentHistory` read one endpoint and differ only
 * in which incidents they keep.
 *
 * Severity comes from `status_impact` rather than from the `severity` word next
 * to it: the two disagree (a "medium" severity carrying a SERVICE_DISRUPTION),
 * and the impact is the one Google's own dashboard renders.
 */

const INCIDENTS_PATH = "/incidents.json";

/**
 * `SERVICE_INFORMATION` is Google's advisory: an announcement, not an outage.
 * It is surfaced as an incident so the operator sees it, but on its own it does
 * not move the provider's status.
 */
const IMPACTS: Record<string, OverallStatus> = {
  SERVICE_INFORMATION: "operational",
  SERVICE_DISRUPTION: "partial_outage",
  SERVICE_OUTAGE: "major_outage",
};

const INFORMATIONAL = "SERVICE_INFORMATION";

const incidentSchema = z.object({
  id: z.string().optional(),
  external_desc: z.string().optional(),
  status_impact: z.string().optional(),
  severity: z.string().optional(),
  service_name: z.string().optional(),
  begin: z.string().optional(),
  created: z.string().optional(),
  end: z.string().nullable().optional(),
  modified: z.string().nullable().optional(),
});

const incidentsSchema = z.array(incidentSchema);

type GcpIncident = z.infer<typeof incidentSchema>;

function severityOf(incident: GcpIncident): OverallStatus {
  // An impact we have never seen reads as an outage rather than as calm.
  return IMPACTS[incident.status_impact ?? ""] ?? "major_outage";
}

/** Google answers in `+00:00` offsets; everything downstream is UTC with a `Z`. */
function toUtc(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** An incident is over exactly when Google gave it an end. */
const isOpen = (incident: GcpIncident): boolean => toUtc(incident.end) === null;

const nameOf = (incident: GcpIncident): string =>
  incident.external_desc ?? incident.service_name ?? "";

function parseBody(raw: string, service: ServiceRef): GcpIncident[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`gcp fetch for ${service.id} returned a body that is not JSON`);
  }
  const parsed = incidentsSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`gcp fetch for ${service.id} returned a body that is not an incident list`);
  }
  // An incident with no id cannot be tracked across cycles, and inventing one
  // would report the same trouble as new on every poll.
  return parsed.data.filter((incident) => incident.id !== undefined);
}

/** Pure mapping from the incident list to a status reading, exported for the tests. */
export function parseGcpStatus(raw: string, service: ServiceRef): NormalizedStatus {
  const open = parseBody(raw, service).filter(isOpen);
  const fetchedAt = new Date().toISOString();

  const activeIncidents: Incident[] = open.map((incident) => ({
    id: incident.id!,
    name: nameOf(incident),
    impact: severityOf(incident),
    // Google publishes no lifecycle word — an incident is open or it has an
    // end — so the impact doubles as the status the notifier quotes.
    status: incident.status_impact ?? "SERVICE_DISRUPTION",
    updatedAt: toUtc(incident.modified) ?? toUtc(incident.begin) ?? fetchedAt,
  }));

  return {
    provider: service.id,
    overallStatus: worstStatus(
      open.filter((incident) => incident.status_impact !== INFORMATIONAL).map(severityOf),
    ),
    activeIncidents,
    // The list names affected products per incident but publishes no per-product
    // status, so there is nothing a picker could offer and nothing a selection
    // could be resolved against.
    components: [],
    // Scheduled maintenance is announced per product in the release notes, not
    // in this document.
    maintenances: [],
    fetchedAt,
  };
}

/**
 * Pure mapping from the same document to the incident timeline. An incident with
 * no start date is dropped: it cannot be placed on a timeline, and inventing a
 * date for it would put a false bar on the chart.
 */
export function parseGcpHistory(raw: string, service: ServiceRef): IncidentHistoryResult {
  const incidents: HistoricalIncident[] = parseBody(raw, service).flatMap((incident) => {
    const startedAt = toUtc(incident.begin) ?? toUtc(incident.created);
    if (startedAt === null) return [];
    const resolvedAt = toUtc(incident.end);
    return [
      {
        id: incident.id!,
        name: nameOf(incident),
        impact: severityOf(incident),
        status: resolvedAt === null ? (incident.status_impact ?? "SERVICE_DISRUPTION") : "resolved",
        startedAt,
        resolvedAt,
        updatedAt: toUtc(incident.modified) ?? resolvedAt ?? startedAt,
      },
    ];
  });

  const oldest = incidents.reduce<string | null>(
    (min, incident) => (min === null || incident.startedAt < min ? incident.startedAt : min),
    null,
  );

  // Never null: the document is a window onto a history, and what rolled off the
  // end of it is exactly what it cannot account for.
  return { incidents, coverageStart: oldest };
}

async function readIncidents(service: ServiceRef, ctx: FetchContext): Promise<string> {
  return fetchConditional(`${service.baseUrl}${INCIDENTS_PATH}`, {
    providerId: service.id,
    accept: "application/json",
    timeoutMs: ctx.timeoutMs,
    onRead: ctx.onRead,
    label: "gcp fetch",
  });
}

export const gcpAdapter: Adapter = {
  id: "gcp",

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    return parseGcpStatus(await readIncidents(service, ctx), service);
  },

  async fetchIncidentHistory(service: ServiceRef, ctx: FetchContext): Promise<IncidentHistoryResult> {
    return parseGcpHistory(await readIncidents(service, ctx), service);
  },
};
