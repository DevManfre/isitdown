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

/**
 * Another IsItDown instance (roadmap 2.11), read through its own `GET /status`.
 *
 * No new protocol: the UI edition already publishes every provider it watches
 * with the normalized vocabulary this adapter returns, so federating is reading
 * that document and showing it as one provider. The peer's providers become the
 * components, and the composite status is the worst of them — the same rule the
 * dashboard's groups use (roadmap 2.6), so a site that reads "degraded" here
 * reads it for the reason its own dashboard gives.
 *
 * `service.baseUrl` is the peer's origin. `options.provider` narrows the read to
 * one of its providers by id, for the operator who wants a single upstream from
 * a friend's instance rather than everything they watch. Credentials for a peer
 * behind a reverse proxy go through the usual `header.<Name>` / `tokenEnv`
 * options.
 *
 * A peer provider that is disabled there is skipped: its `unknown` is not a
 * reading, and counting it would let a muted provider on the other side drag the
 * composite to `unknown`.
 */
const status = z.enum(["operational", "degraded", "partial_outage", "major_outage", "unknown"]);

const peerIncidentSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  impact: z.string().optional(),
  status: z.string().optional(),
  updatedAt: z.string().optional(),
  createdAt: z.string().optional(),
});

const peerMaintenanceSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  status: z.string().optional(),
  startsAt: z.string(),
  endsAt: z.string().nullable().optional(),
});

const peerProviderSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  overallStatus: status,
  activeIncidents: z.array(peerIncidentSchema).default([]),
  maintenance: z.object({ active: z.array(peerMaintenanceSchema).default([]) }).optional(),
});

const peerSchema = z.object({ providers: z.array(peerProviderSchema) });

const RANK: Record<OverallStatus, number> = {
  unknown: 0,
  operational: 1,
  degraded: 2,
  partial_outage: 3,
  major_outage: 4,
};

/** Worst known status; `unknown` abstains, and a peer with nothing known is `unknown`. */
function worstOf(statuses: OverallStatus[]): OverallStatus {
  return statuses.reduce<OverallStatus>((worst, next) => (RANK[next] > RANK[worst] ? next : worst), "unknown");
}

/** Throws on a body that is not a peer's `/status` — the poller's retry accounting depends on it. */
function parseBody(raw: string, service: ServiceRef): z.infer<typeof peerSchema> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`isitdown fetch ${service.id}: the body is not JSON`);
  }
  const parsed = peerSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`isitdown fetch ${service.id}: not an IsItDown /status document (${parsed.error.issues[0]?.message ?? "unreadable"})`);
  }
  return parsed.data;
}

function membersOf(body: z.infer<typeof peerSchema>, service: ServiceRef): z.infer<typeof peerProviderSchema>[] {
  const only = (service.options?.["provider"] ?? "").trim();
  return body.providers.filter((member) => member.enabled !== false && (only === "" || member.id === only));
}

function scoped(service: ServiceRef): boolean {
  return service.scopeToComponents === true && (service.components ?? []).length > 0;
}

/** Pure mapping from the peer's body to a reading, exported for the tests. */
export function parseIsItDownStatus(raw: string, service: ServiceRef): NormalizedStatus {
  const members = membersOf(parseBody(raw, service), service);
  const only = (service.options?.["provider"] ?? "").trim();
  if (only !== "" && members.length === 0) {
    throw new Error(`isitdown fetch ${service.id}: the peer has no enabled provider "${only}"`);
  }
  const fetchedAt = new Date().toISOString();

  const listed = new Map(members.map((member) => [member.id, member]));
  const components: ComponentStatus[] = (service.components ?? []).map((selection) => ({
    id: selection.id,
    name: listed.get(selection.id)?.name ?? selection.name,
    // A provider the peer no longer lists reads `unknown`, never operational.
    status: listed.get(selection.id)?.overallStatus ?? "unknown",
  }));

  const counted = scoped(service)
    ? members.filter((member) => (service.components ?? []).some((selection) => selection.id === member.id))
    : members;

  const activeIncidents: Incident[] = counted.flatMap((member) =>
    member.activeIncidents.map((incident) => ({
      // Prefixed: two peer providers may reuse an id, and a federated incident
      // id has to stay unique among the ones this provider reports.
      id: `${member.id}:${incident.id}`,
      name: `${member.name ?? member.id}: ${incident.name ?? ""}`.trim(),
      impact: incident.impact ?? "",
      status: incident.status ?? "",
      updatedAt: incident.updatedAt ?? fetchedAt,
      ...(incident.createdAt !== undefined ? { createdAt: incident.createdAt } : {}),
    })),
  );

  const maintenances: MaintenanceWindow[] = counted.flatMap((member) =>
    (member.maintenance?.active ?? []).map((window) => ({
      id: `${member.id}:${window.id}`,
      name: `${member.name ?? member.id}: ${window.name ?? ""}`.trim(),
      status: window.status ?? "",
      startsAt: window.startsAt,
      endsAt: window.endsAt ?? null,
      componentIds: [],
    })),
  );

  return {
    provider: service.id,
    overallStatus: worstOf(counted.map((member) => member.overallStatus)),
    activeIncidents,
    components,
    maintenances,
    fetchedAt,
  };
}

/** Pure mapping from the peer's body to the picker's rows, exported for the tests. */
export function parseIsItDownComponents(raw: string, service: ServiceRef): ComponentPreview[] {
  return membersOf(parseBody(raw, service), service).map((member) => ({
    id: member.id,
    name: member.name ?? member.id,
    group: null,
    showcase: false,
    status: member.overallStatus,
  }));
}

async function read(service: ServiceRef, ctx: FetchContext): Promise<string> {
  return fetchConditional(`${service.baseUrl.replace(/\/+$/, "")}/status`, {
    providerId: service.id,
    accept: "application/json",
    timeoutMs: ctx.timeoutMs,
    onRead: ctx.onRead,
    auth: service.options,
    label: "isitdown fetch",
  });
}

export const isItDownAdapter: Adapter = {
  id: "isitdown",
  version: 1,

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    return parseIsItDownStatus(await read(service, ctx), service);
  },

  async listComponents(service: ServiceRef, ctx: FetchContext): Promise<ComponentPreview[]> {
    return parseIsItDownComponents(await read(service, ctx), service);
  },
};
