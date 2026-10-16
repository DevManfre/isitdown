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
 * A Sorry™ status page (roadmap 2.12), through the unauthenticated API every
 * page serves beside itself: `/api/v1/status` (the page's state),
 * `/api/v1/components` and `/api/v1/notices`. `service.baseUrl` is the page.
 *
 * Sorry's vocabulary is three words, `operational`, `partially-degraded` and
 * `degraded`. The first two are what they say; `degraded` is Sorry's word for
 * "affected as a whole", which is a partial outage on our scale (Sorry has no
 * word for a total one). A word nothing here knows reads as the worst case.
 *
 * Notices are the incidents: an unplanned one that is not `resolved` or
 * `false_alarm` is open; a planned one that is not `complete` or `cancelled` is
 * a maintenance window; a `general` one is an announcement and is ignored.
 */
const stateOf = (word: string | undefined): OverallStatus => {
  if (word === undefined || word === "") return "unknown";
  switch (word) {
    case "operational":
      return "operational";
    case "partially-degraded":
      return "degraded";
    case "degraded":
      return "partial_outage";
    default:
      return "major_outage";
  }
};

const statusSchema = z.object({ page: z.object({ state: z.string().optional() }) });

const componentsSchema = z.object({
  components: z.array(z.object({ id: z.union([z.number(), z.string()]), name: z.string().optional(), state: z.string().optional(), parent_id: z.union([z.number(), z.string()]).nullable().optional() })),
});

const noticeSchema = z.object({
  id: z.union([z.number(), z.string()]),
  type: z.string().optional(),
  state: z.string().optional(),
  subject: z.string().optional(),
  begins_at: z.string().nullable().optional(),
  ends_at: z.string().nullable().optional(),
  began_at: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

const noticesSchema = z.object({ notices: z.array(noticeSchema) });

function parse<S extends z.ZodTypeAny>(raw: string, schema: S, service: ServiceRef, what: string): z.infer<S> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`sorry fetch ${service.id}: ${what} body is not JSON`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new Error(`sorry fetch ${service.id}: not a Sorry ${what} document`);
  return parsed.data;
}

const CLOSED = new Set(["resolved", "false_alarm", "complete", "cancelled"]);

function scoped(service: ServiceRef): boolean {
  return service.scopeToComponents === true && (service.components ?? []).length > 0;
}

function worstKnown(statuses: OverallStatus[]): OverallStatus {
  const rank: Record<OverallStatus, number> = { unknown: 0, operational: 1, degraded: 2, partial_outage: 3, major_outage: 4 };
  return statuses.reduce<OverallStatus>((worst, next) => (rank[next] > rank[worst] ? next : worst), "unknown");
}

/** Pure mapping from the three bodies to a reading, exported for the tests. */
export function parseSorryStatus(
  statusRaw: string,
  componentsRaw: string,
  noticesRaw: string,
  service: ServiceRef,
): NormalizedStatus {
  const page = parse(statusRaw, statusSchema, service, "status");
  const all = parse(componentsRaw, componentsSchema, service, "components").components;
  const notices = parse(noticesRaw, noticesSchema, service, "notices").notices;
  const fetchedAt = new Date().toISOString();

  const listed = new Map(all.map((component) => [String(component.id), component]));
  const components: ComponentStatus[] = (service.components ?? []).map((selection) => ({
    id: selection.id,
    name: listed.get(selection.id)?.name ?? selection.name,
    status: stateOf(listed.get(selection.id)?.state),
  }));

  const open = notices.filter((notice) => !CLOSED.has(notice.state ?? ""));
  const activeIncidents: Incident[] = open
    // `general` notices are announcements with no lifecycle (a changelog post on
    // Sorry's own page): they are not outages, so only `unplanned` ones count.
    .filter((notice) => notice.type === "unplanned")
    .map((notice) => ({
      id: String(notice.id),
      name: notice.subject ?? "",
      impact: notice.type ?? "",
      status: notice.state ?? "",
      updatedAt: notice.updated_at ?? notice.created_at ?? fetchedAt,
      ...createdAtOf(notice.created_at),
    }));
  const maintenances: MaintenanceWindow[] = open
    .filter((notice) => notice.type === "planned" && notice.begins_at != null)
    .map((notice) => ({
      id: String(notice.id),
      name: notice.subject ?? "",
      status: notice.state ?? "",
      startsAt: notice.begins_at as string,
      endsAt: notice.ends_at ?? null,
      componentIds: [],
    }));

  return {
    provider: service.id,
    overallStatus: scoped(service) ? worstKnown(components.map((c) => c.status)) : stateOf(page.page.state),
    activeIncidents,
    components,
    maintenances,
    fetchedAt,
  };
}

/** Pure mapping from the components body to the picker's rows. */
export function parseSorryComponents(raw: string, service: ServiceRef): ComponentPreview[] {
  const all = parse(raw, componentsSchema, service, "components").components;
  const names = new Map(all.map((component) => [String(component.id), component.name ?? String(component.id)]));
  return all.map((component) => ({
    id: String(component.id),
    name: component.name ?? String(component.id),
    group: component.parent_id == null ? null : (names.get(String(component.parent_id)) ?? null),
    showcase: false,
    status: stateOf(component.state),
  }));
}

async function read(path: string, service: ServiceRef, ctx: FetchContext): Promise<string> {
  return fetchConditional(`${service.baseUrl.replace(/\/+$/, "")}${path}`, {
    providerId: service.id,
    accept: "application/json",
    timeoutMs: ctx.timeoutMs,
    onRead: ctx.onRead,
    auth: service.options,
    label: "sorry fetch",
  });
}

export const sorryAdapter: Adapter = {
  id: "sorry",
  version: 1,

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    const [status, components, notices] = await Promise.all([
      read("/api/v1/status", service, ctx),
      read("/api/v1/components", service, ctx),
      read("/api/v1/notices", service, ctx),
    ]);
    return parseSorryStatus(status, components, notices, service);
  },

  async listComponents(service: ServiceRef, ctx: FetchContext): Promise<ComponentPreview[]> {
    return parseSorryComponents(await read("/api/v1/components", service, ctx), service);
  },
};
