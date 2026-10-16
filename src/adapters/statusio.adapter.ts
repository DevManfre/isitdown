import { z } from "zod";
import type { Adapter, ComponentPreview, FetchContext, ServiceRef } from "../core/adapter.interface.ts";
import type {
  ComponentStatus,
  Incident,
  MaintenanceWindow,
  NormalizedStatus,
  OverallStatus,
} from "../core/types.ts";
import { fetchConditional } from "../core/http.ts";
import { createdAtOf } from "./createdAt.ts";

/**
 * A Status.io page (roadmap 2.12), read through its public status API,
 * `GET /1.0/status/<page id>`.
 *
 * The page id is not in the page's public url, so it is a thing the operator
 * copies from Status.io's own "API" tab: either the whole endpoint as the base
 * url (`https://api.status.io/1.0/status/<id>`), or the host as the base url and
 * the id in `options.pageId`.
 *
 * Status.io numbers its states: 100 operational, 200 planned maintenance, 300
 * degraded performance, 400 partial service disruption, 500 service disruption,
 * 600 security event. Maintenance maps to `unknown` for the reason Statuspage's
 * `under_maintenance` does — the normalized model has no maintenance state, and
 * `unknown` abstains in the diff engine's recovery check. A code nothing here
 * knows reads as the worst case.
 */
const STATUS_CODES: Record<number, OverallStatus> = {
  100: "operational",
  200: "unknown",
  300: "degraded",
  400: "partial_outage",
  500: "major_outage",
  600: "partial_outage",
};

function mapCode(code: number | undefined): OverallStatus {
  if (code === undefined) return "unknown";
  return STATUS_CODES[code] ?? "major_outage";
}

const incidentSchema = z.object({
  _id: z.string().optional(),
  name: z.string().optional(),
  datetime_open: z.string().optional(),
  messages: z.array(z.object({ datetime: z.string().optional(), status: z.number().optional() })).default([]),
});

const maintenanceSchema = z.object({
  _id: z.string().optional(),
  name: z.string().optional(),
  datetime_planned_start: z.string().optional(),
  datetime_planned_end: z.string().optional(),
});

const bodySchema = z.object({
  result: z.object({
    status_overall: z.object({ status_code: z.number().optional() }),
    status: z.array(z.object({ id: z.string().optional(), name: z.string().optional(), status_code: z.number().optional() })).default([]),
    incidents: z.array(incidentSchema).default([]),
    maintenance: z
      .object({ active: z.array(maintenanceSchema).default([]), upcoming: z.array(maintenanceSchema).default([]) })
      .optional(),
  }),
});

function parseBody(raw: string, service: ServiceRef): z.infer<typeof bodySchema>["result"] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`statusio fetch ${service.id}: the body is not JSON`);
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`statusio fetch ${service.id}: not a Status.io status document (${parsed.error.issues[0]?.message ?? "unreadable"})`);
  }
  return parsed.data.result;
}

function isoOf(stamp: string | undefined): string | null {
  if (stamp === undefined) return null;
  const parsed = new Date(stamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function componentsOf(result: z.infer<typeof bodySchema>["result"]): ComponentStatus[] {
  return result.status.flatMap((component) =>
    component.id === undefined
      ? []
      : [{ id: component.id, name: component.name ?? component.id, status: mapCode(component.status_code) }],
  );
}

function scoped(service: ServiceRef): boolean {
  return service.scopeToComponents === true && (service.components ?? []).length > 0;
}

/** Pure mapping from the body to a reading, exported for the tests. */
export function parseStatusIoStatus(raw: string, service: ServiceRef): NormalizedStatus {
  const result = parseBody(raw, service);
  const fetchedAt = new Date().toISOString();
  const listed = new Map(componentsOf(result).map((component) => [component.id, component]));
  const components: ComponentStatus[] = (service.components ?? []).map((selection) => ({
    id: selection.id,
    name: listed.get(selection.id)?.name ?? selection.name,
    status: listed.get(selection.id)?.status ?? "unknown",
  }));

  const incidents: Incident[] = result.incidents.flatMap((incident) => {
    if (incident._id === undefined) return [];
    const opened = isoOf(incident.datetime_open);
    const last = incident.messages[incident.messages.length - 1];
    return [
      {
        id: incident._id,
        name: incident.name ?? "",
        impact: "",
        status: "",
        updatedAt: isoOf(last?.datetime) ?? opened ?? fetchedAt,
        ...createdAtOf(opened),
      },
    ];
  });

  const maintenances: MaintenanceWindow[] = [
    ...(result.maintenance?.active ?? []),
    ...(result.maintenance?.upcoming ?? []),
  ].flatMap((window) => {
    const startsAt = isoOf(window.datetime_planned_start);
    if (window._id === undefined || startsAt === null) return [];
    return [
      {
        id: window._id,
        name: window.name ?? "",
        status: "",
        startsAt,
        endsAt: isoOf(window.datetime_planned_end),
        componentIds: [],
      },
    ];
  });

  const overall = mapCode(result.status_overall.status_code);
  return {
    provider: service.id,
    overallStatus: scoped(service) ? worstKnown(components.map((component) => component.status)) : overall,
    activeIncidents: incidents,
    components,
    maintenances,
    fetchedAt,
  };
}

const RANK: Record<OverallStatus, number> = {
  unknown: 0,
  operational: 1,
  degraded: 2,
  partial_outage: 3,
  major_outage: 4,
};

function worstKnown(statuses: OverallStatus[]): OverallStatus {
  return statuses.reduce<OverallStatus>((worst, next) => (RANK[next] > RANK[worst] ? next : worst), "unknown");
}

/** Pure mapping from the body to the picker's rows, exported for the tests. */
export function parseStatusIoComponents(raw: string, service: ServiceRef): ComponentPreview[] {
  return componentsOf(parseBody(raw, service)).map((component) => ({
    id: component.id,
    name: component.name,
    group: null,
    showcase: false,
    status: component.status,
  }));
}

/** The endpoint: the base url itself, or the host plus `options.pageId`. */
export function endpointOf(service: ServiceRef): string {
  const base = service.baseUrl.replace(/\/+$/, "");
  const pageId = (service.options?.["pageId"] ?? "").trim();
  return pageId === "" ? base : `${base}/1.0/status/${encodeURIComponent(pageId)}`;
}

async function read(service: ServiceRef, ctx: FetchContext): Promise<string> {
  return fetchConditional(endpointOf(service), {
    providerId: service.id,
    accept: "application/json",
    timeoutMs: ctx.timeoutMs,
    onRead: ctx.onRead,
    auth: service.options,
    label: "statusio fetch",
  });
}

export const statusIoAdapter: Adapter = {
  id: "statusio",
  version: 1,

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    return parseStatusIoStatus(await read(service, ctx), service);
  },

  async listComponents(service: ServiceRef, ctx: FetchContext): Promise<ComponentPreview[]> {
    return parseStatusIoComponents(await read(service, ctx), service);
  },
};
