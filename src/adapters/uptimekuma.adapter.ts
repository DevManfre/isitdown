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
 * Uptime Kuma's published status pages (roadmap 1.15).
 *
 * Two public endpoints per page, both JSON and both unauthenticated once the
 * page is published: `/api/status-page/<slug>` carries the page's configuration,
 * its pinned incident, the monitor groups and any window currently under
 * maintenance, and `/api/status-page/heartbeat/<slug>` carries the beats. The
 * split is the point — the first document names the monitors and never says how
 * they are doing, the second says how they are doing and never names them — so
 * unlike Instatus's optional second read, both are needed on every cycle.
 *
 * `service.baseUrl` is the status page as the operator sees it in the browser —
 * `https://uptime.example.com/status/demo` — and the slug is read out of it.
 * The instance's bare origin works too, for a page published under Kuma's own
 * `default` slug or with `options.slug` naming another; a page reached through a
 * CNAME is that same case, since the custom domain serves one page at its root.
 *
 * Uptime Kuma is a prober, not a status page someone writes: the page publishes
 * no aggregate word, so the reading is folded from the beats the way Kuma's own
 * header does it — everything up is operational, some up and some down is a
 * partial outage, nothing up at all is a major one.
 */

const DEFAULT_SLUG = "default";

const monitorSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  name: z.string().optional(),
});

const groupSchema = z.object({
  name: z.string().optional(),
  monitorList: z.array(monitorSchema).default([]),
});

const incidentSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  style: z.string().optional(),
  createdDate: z.string().optional(),
  lastUpdatedDate: z.string().nullable().optional(),
});

const maintenanceSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  title: z.string().optional(),
  status: z.string().optional(),
  timezoneOffset: z.string().nullable().optional(),
  timeslotList: z
    .array(
      z.object({
        startDate: z.string().nullable().optional(),
        endDate: z.string().nullable().optional(),
      }),
    )
    .default([]),
});

const statusPageSchema = z.object({
  config: z.object({ slug: z.string().optional(), title: z.string().optional() }).optional(),
  /** 1.x pins at most one incident and writes it singular; 2.x writes a list. */
  incident: incidentSchema.nullable().optional(),
  incidents: z.array(incidentSchema).optional(),
  publicGroupList: z.array(groupSchema).default([]),
  maintenanceList: z.array(maintenanceSchema).default([]),
});

const beatSchema = z.object({
  status: z.union([z.number(), z.string()]).optional(),
  time: z.string().optional(),
});

const heartbeatSchema = z.object({
  heartbeatList: z.record(z.string(), z.array(beatSchema)).default({}),
  uptimeList: z.record(z.string(), z.union([z.number(), z.string()])).default({}),
});

/**
 * Kuma's beat vocabulary is numeric: 0 down, 1 up, 2 pending (a check that has
 * failed but not yet spent its retries), 3 under maintenance. `3` maps to
 * `unknown` for the same reason Statuspage's `under_maintenance` does — the
 * normalized model has no maintenance state, and `unknown` abstains in the diff
 * engine rather than reading as a recovery. A number nothing knows is treated as
 * the worst case, as in every other adapter here.
 */
const BEAT_STATUSES: Record<string, OverallStatus> = {
  "0": "major_outage",
  "1": "operational",
  "2": "degraded",
  "3": "unknown",
};

function mapBeat(status: number | string | undefined): OverallStatus {
  if (status === undefined || status === "") return "unknown";
  return BEAT_STATUSES[String(status)] ?? "major_outage";
}

/** Throws when the body is not Kuma's payload — the poller's retry accounting depends on it. */
function parseBody<S extends z.ZodTypeAny>(raw: string, schema: S, service: ServiceRef, what: string): z.infer<S> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`uptimekuma ${what} fetch for ${service.id} returned a body that is not JSON`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`uptimekuma ${what} fetch for ${service.id} returned a body that is not a status-page payload`);
  }
  return parsed.data;
}

/**
 * Kuma writes a timestamp without a zone (`2026-09-12 12:24:39.701`), in the
 * server's own local time, and the payload says nowhere which that is. Read as
 * UTC, which is what a container install runs on, unless the document offers an
 * offset of its own — a maintenance window does.
 */
function isoOf(stamp: string | null | undefined, offset = ""): string | null {
  if (stamp === undefined || stamp === null) return null;
  const text = stamp.trim();
  if (text === "") return null;
  const zoned = /[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(" ", "T")}${offset === "" ? "Z" : offset}`;
  const parsed = Date.parse(zoned);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** The monitors the page lists, in order, with the group that carries each. */
function monitorsOf(page: z.infer<typeof statusPageSchema>): { id: string; name: string; group: string | null }[] {
  return page.publicGroupList.flatMap((group) =>
    group.monitorList
      .filter((monitor) => monitor.id !== undefined)
      .map((monitor) => ({
        id: String(monitor.id),
        name: monitor.name ?? "",
        group: group.name ?? null,
      })),
  );
}

/** The newest beat per monitor, normalized. A monitor with no beat abstains. */
function statusesOf(beats: z.infer<typeof heartbeatSchema>): Map<string, OverallStatus> {
  return new Map(
    Object.entries(beats.heartbeatList).map(([monitorId, list]) => {
      // Kuma sends the beats oldest first, so the page can draw them left to
      // right; the last one is the monitor's current state.
      const latest = list[list.length - 1];
      return [monitorId, latest === undefined ? "unknown" : mapBeat(latest.status)];
    }),
  );
}

/**
 * The page's own header rule, which is not a worst-of: one monitor down out of
 * ten is a partial outage on a Kuma page, and calling it a major one here would
 * make every fleet with a Kuma page in it read worse than the page does.
 * `unknown` abstains — a monitor under maintenance or without a beat yet is not
 * evidence either way — and a page where everything abstains is `unknown`.
 */
function foldStatuses(statuses: OverallStatus[]): OverallStatus {
  const known = statuses.filter((status) => status !== "unknown");
  if (known.length === 0) return "unknown";
  const down = known.filter((status) => status === "major_outage").length;
  if (down === known.length) return "major_outage";
  if (down > 0) return "partial_outage";
  return known.some((status) => status === "degraded") ? "degraded" : "operational";
}

/**
 * Scoping only bites once something is selected: an operator who asks for it and
 * then picks nothing must keep seeing the whole page, not go silent.
 */
function scoped(service: ServiceRef): boolean {
  return service.scopeToComponents === true && (service.components ?? []).length > 0;
}

/** Pure mapping from the two bodies to a reading, exported for the tests. */
export function parseUptimeKumaStatus(pageRaw: string, heartbeatRaw: string, service: ServiceRef): NormalizedStatus {
  const page = parseBody(pageRaw, statusPageSchema, service, "status page");
  const beats = parseBody(heartbeatRaw, heartbeatSchema, service, "heartbeat");
  const fetchedAt = new Date().toISOString();

  const statuses = statusesOf(beats);
  const monitors = monitorsOf(page).map((monitor) => ({
    ...monitor,
    status: statuses.get(monitor.id) ?? "unknown",
  }));
  const listed = new Map(monitors.map((monitor) => [monitor.id, monitor]));

  const components: ComponentStatus[] = (service.components ?? []).map((selection) => ({
    id: selection.id,
    // The page's current name wins; the stored one is the fallback for a monitor
    // the page has since dropped or renamed away.
    name: listed.get(selection.id)?.name ?? selection.name,
    // A selection the page no longer lists reads `unknown`, never operational.
    status: listed.get(selection.id)?.status ?? "unknown",
  }));

  // Kuma's pinned incident is one free-text notice the operator wrote, with no
  // components attached, so there is nothing to scope it by: it stays whatever
  // the selection is, the same safe direction the Instatus adapter takes.
  const pinned = page.incidents ?? (page.incident === null || page.incident === undefined ? [] : [page.incident]);
  const activeIncidents: Incident[] = pinned
    .filter((incident) => incident.id !== undefined)
    .map((incident) => ({
      id: String(incident.id),
      name: incident.title ?? "",
      // Kuma's own word for how loud the notice is (`info`, `warning`,
      // `danger`), unnormalised, so a notifier can quote the page rather than us.
      impact: incident.style ?? "",
      status: incident.style ?? "",
      updatedAt: isoOf(incident.lastUpdatedDate) ?? isoOf(incident.createdDate) ?? fetchedAt,
    }));

  const maintenances: MaintenanceWindow[] = page.maintenanceList.flatMap((window) => {
    const id = window.id;
    const slot = window.timeslotList[0];
    const offset = window.timezoneOffset ?? "";
    const startsAt = isoOf(slot?.startDate, offset);
    // A window with no id cannot be told from the next one, and one we cannot
    // place on a clock cannot silence anything.
    if (id === undefined || startsAt === null) return [];
    return [
      {
        id: String(id),
        name: window.title ?? "",
        status: window.status ?? "",
        startsAt,
        endsAt: isoOf(slot?.endDate, offset),
        // The page's maintenance entry does not say which monitors it covers.
        componentIds: [],
      },
    ];
  });

  return {
    provider: service.id,
    overallStatus: foldStatuses(
      (scoped(service) ? components : monitors).map((component) => component.status),
    ),
    activeIncidents,
    components,
    maintenances,
    fetchedAt,
  };
}

/** Pure mapping from the two bodies to the picker's rows, exported for the tests. */
export function parseUptimeKumaComponents(
  pageRaw: string,
  heartbeatRaw: string,
  service: ServiceRef,
): ComponentPreview[] {
  const page = parseBody(pageRaw, statusPageSchema, service, "status page");
  const statuses = statusesOf(parseBody(heartbeatRaw, heartbeatSchema, service, "heartbeat"));
  return monitorsOf(page).map((monitor) => ({
    id: monitor.id,
    name: monitor.name,
    group: monitor.group,
    // Kuma publishes no "featured" flag; the picker's hint simply has nothing to
    // go on here.
    showcase: false,
    status: statuses.get(monitor.id) ?? "unknown",
  }));
}

/**
 * Kuma publishes a page at `/status/<slug>`, which is the url an operator has
 * open when they come to add one, so the slug is taken from the configured url
 * before anything else. `options.slug` overrides it, and Kuma's own `default` is
 * the answer when neither says.
 */
export function pageOf(service: ServiceRef): { origin: string; slug: string } {
  const configured = (service.options?.["slug"] ?? "").trim();
  const trimmed = service.baseUrl.replace(/\/+$/, "");
  const inUrl = /^(?<origin>.*)\/status\/(?<slug>[^/]+)$/.exec(trimmed);
  return {
    origin: inUrl?.groups?.["origin"] ?? trimmed,
    slug: configured !== "" ? configured : (inUrl?.groups?.["slug"] ?? DEFAULT_SLUG),
  };
}

async function readJson(path: string, origin: string, service: ServiceRef, ctx: FetchContext): Promise<string> {
  return fetchConditional(`${origin}${path}`, {
    // The cache is keyed by provider *and* url, so the two paths under one id
    // are two entries — and `forgetProvider` still drops both at once.
    providerId: service.id,
    accept: "application/json",
    timeoutMs: ctx.timeoutMs,
    onRead: ctx.onRead,
    label: "uptimekuma fetch",
  });
}

async function readPage(service: ServiceRef, ctx: FetchContext): Promise<[string, string]> {
  const { origin, slug } = pageOf(service);
  return Promise.all([
    readJson(`/api/status-page/${encodeURIComponent(slug)}`, origin, service, ctx),
    readJson(`/api/status-page/heartbeat/${encodeURIComponent(slug)}`, origin, service, ctx),
  ]);
}

export const uptimeKumaAdapter: Adapter = {
  id: "uptimekuma",

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    const [page, heartbeat] = await readPage(service, ctx);
    return parseUptimeKumaStatus(page, heartbeat, service);
  },

  async listComponents(service: ServiceRef, ctx: FetchContext): Promise<ComponentPreview[]> {
    const [page, heartbeat] = await readPage(service, ctx);
    return parseUptimeKumaComponents(page, heartbeat, service);
  },

  // No `fetchIncidentHistory`: a Kuma page publishes the beats and the one
  // notice pinned to it, and nothing that amounts to a closed incident with a
  // start and an end. The timeline is built from what this instance samples.
};
