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
 * Cachet, the status page this project's own audience self-hosts (roadmap 1.15).
 *
 * Three public endpoints, all JSON and all unauthenticated on a default install:
 * `/api/v1/components` (every component with its numeric status),
 * `/api/v1/incidents` (every incident with its updates) and `/api/v1/schedules`
 * (declared maintenance windows, which Cachet keeps in a table of their own
 * rather than as a kind of incident). `service.baseUrl` is the page's host, as
 * everywhere else.
 *
 * Unlike Instatus and Better Stack, Cachet publishes no aggregate word at all:
 * `/api/v1/status` exists but answers a three-way `success`/`info`/`danger`,
 * which cannot tell a partial outage from a major one. The reading is folded
 * from the components instead — the same document a scoped provider is folded
 * from, so both paths agree by construction.
 *
 * Every list is paged, and a page is asked for at the API's own ceiling of 100
 * rows. A Cachet with more than 100 components is read as its first hundred: the
 * alternative is walking `meta.pagination` on every cycle, which turns one
 * conditional read into an unbounded number of unconditional ones.
 */

const PER_PAGE = 100;
const COMPONENTS_PATH = `/api/v1/components?per_page=${PER_PAGE}`;
const INCIDENTS_PATH = `/api/v1/incidents?per_page=${PER_PAGE}`;
const SCHEDULES_PATH = `/api/v1/schedules?per_page=${PER_PAGE}`;
const GROUPS_PATH = `/api/v1/components/groups?per_page=${PER_PAGE}`;

/** Cachet writes a timestamp with no zone; a number is accepted for the same field. */
const stampSchema = z.union([z.string(), z.number()]).optional();

const componentSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  name: z.string().optional(),
  status: z.union([z.number(), z.string()]).optional(),
  group_id: z.union([z.number(), z.string()]).optional(),
  enabled: z.boolean().optional(),
});

const componentsSchema = z.object({
  data: z.array(componentSchema).default([]),
});

const incidentSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  name: z.string().optional(),
  status: z.union([z.number(), z.string()]).optional(),
  component_id: z.union([z.number(), z.string()]).optional(),
  is_resolved: z.boolean().optional(),
  latest_status: z.union([z.number(), z.string()]).optional(),
  latest_human_status: z.string().optional(),
  human_status: z.string().optional(),
  occurred_at: stampSchema,
  created_at: stampSchema,
  updated_at: stampSchema,
});

const incidentsSchema = z.object({
  data: z.array(incidentSchema).default([]),
});

const scheduleSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  name: z.string().optional(),
  status: z.union([z.number(), z.string()]).optional(),
  human_status: z.string().optional(),
  scheduled_at: stampSchema,
  completed_at: stampSchema,
  components: z.array(componentSchema).default([]),
});

const schedulesSchema = z.object({
  data: z.array(scheduleSchema).default([]),
});

const groupsSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.union([z.number(), z.string()]).optional(),
        name: z.string().optional(),
      }),
    )
    .default([]),
});

/**
 * Cachet's component vocabulary is numeric, and the numbers are the API: 1 is
 * operational, 4 is a major outage. A number nothing knows is treated as the
 * worst case, as in every other adapter here — silently downgrading an outage to
 * operational is the one failure mode that matters.
 */
const COMPONENT_STATUSES: Record<string, OverallStatus> = {
  "1": "operational",
  "2": "degraded",
  "3": "partial_outage",
  "4": "major_outage",
};

/** An incident in this state is over; Cachet calls it "Fixed". */
const FIXED = "4";

/** A schedule Cachet has closed can no longer silence anything. */
const SCHEDULE_COMPLETE = "2";

function mapComponentStatus(word: number | string | undefined): OverallStatus {
  if (word === undefined || word === "") return "unknown";
  return COMPONENT_STATUSES[String(word)] ?? "major_outage";
}

/** Throws when the body is not Cachet's payload — the poller's retry accounting depends on it. */
function parseBody<S extends z.ZodTypeAny>(raw: string, schema: S, service: ServiceRef, what: string): z.infer<S> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`cachet ${what} fetch for ${service.id} returned a body that is not JSON`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`cachet ${what} fetch for ${service.id} returned a body that is not a status-page payload`);
  }
  return parsed.data;
}

/**
 * Cachet timestamps carry no zone: `2026-09-12 13:00:03` is the instance's own
 * local time, and the API says nowhere which that is. Read as UTC, which is what
 * a container install runs on, and dropped rather than guessed when it does not
 * parse at all — a wrong hour on a timeline is a smaller lie than an invented
 * timestamp somewhere else entirely.
 */
function isoOf(stamp: string | number | undefined): string | null {
  if (stamp === undefined) return null;
  const text = String(stamp).trim();
  if (text === "") return null;
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(text)
    ? `${text.replace(" ", "T")}${/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? "" : "Z"}`
    : text;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** Severity worst last. `unknown` is absent: it ranks nowhere, it only abstains. */
const SEVERITY: OverallStatus[] = ["operational", "degraded", "partial_outage", "major_outage"];

function worstOf(components: { status: OverallStatus }[]): OverallStatus {
  const worst = components.reduce((rank, component) => Math.max(rank, SEVERITY.indexOf(component.status)), -1);
  return SEVERITY[worst] ?? "unknown";
}

/**
 * Scoping only bites once something is selected: an operator who asks for it and
 * then picks nothing must keep seeing the whole page, not go silent.
 */
function scopeOf(service: ServiceRef): Set<string> | null {
  const selection = service.components ?? [];
  if (service.scopeToComponents !== true || selection.length === 0) return null;
  return new Set(selection.map((component) => component.id));
}

interface Reading {
  components: { id: string; name: string; group: string | null; status: OverallStatus }[];
  incidents: {
    id: string;
    name: string;
    status: string;
    resolved: boolean;
    componentId: string | null;
    startedAt: string | null;
    updatedAt: string;
  }[];
}

/** The two documents `fetchStatus` reads, in this codebase's own terms. */
function readPage(componentsRaw: string, incidentsRaw: string, service: ServiceRef): Reading {
  const fetchedAt = new Date().toISOString();
  const components = parseBody(componentsRaw, componentsSchema, service, "components")
    .data.filter((component) => component.id !== undefined)
    // A component the operator disabled is not on the page and is not a reading.
    .filter((component) => component.enabled !== false)
    .map((component) => ({
      id: String(component.id),
      name: component.name ?? "",
      // The group's name needs a second endpoint, which only the picker pays
      // for; a reading never shows one.
      group: null,
      status: mapComponentStatus(component.status),
    }));

  const incidents = parseBody(incidentsRaw, incidentsSchema, service, "incidents")
    .data.filter((incident) => incident.id !== undefined)
    .map((incident) => {
      const latest = incident.latest_status ?? incident.status;
      return {
        id: String(incident.id),
        name: incident.name ?? "",
        // Cachet's own words, unnormalised, so a notifier can quote the
        // provider rather than us.
        status: incident.latest_human_status ?? incident.human_status ?? "",
        // `is_resolved` is the page's own answer; the latest update's status is
        // the fallback for a Cachet old enough not to publish the flag.
        resolved: incident.is_resolved ?? String(latest ?? "") === FIXED,
        // Cachet attributes an incident to at most one component, and 0 means
        // none: a page-wide announcement.
        componentId:
          incident.component_id === undefined || String(incident.component_id) === "0"
            ? null
            : String(incident.component_id),
        startedAt: isoOf(incident.occurred_at ?? incident.created_at),
        updatedAt: isoOf(incident.updated_at) ?? isoOf(incident.occurred_at) ?? fetchedAt,
      };
    });

  return { components, incidents };
}

/** Pure mapping from the two bodies to a reading, exported for the tests. */
export function parseCachetStatus(
  componentsRaw: string,
  incidentsRaw: string,
  schedulesRaw: string,
  service: ServiceRef,
): NormalizedStatus {
  const page = readPage(componentsRaw, incidentsRaw, service);
  const fetchedAt = new Date().toISOString();
  const scope = scopeOf(service);
  const listed = new Map(page.components.map((component) => [component.id, component]));

  const activeIncidents: Incident[] = page.incidents
    .filter((incident) => !incident.resolved)
    .filter(
      // An incident attributed to nothing is a page-wide announcement and never
      // out of scope: dropping it would hide the provider's own global notices.
      (incident) => scope === null || incident.componentId === null || scope.has(incident.componentId),
    )
    .map((incident) => ({
      id: incident.id,
      name: incident.name,
      impact: incident.status,
      status: incident.status,
      updatedAt: incident.updatedAt,
    }));

  const components: ComponentStatus[] = (service.components ?? []).map((selection) => ({
    id: selection.id,
    // The provider's current name wins; the stored one is the fallback for a
    // component the page has since dropped or renamed away.
    name: listed.get(selection.id)?.name ?? selection.name,
    // A selection the page no longer lists reads `unknown`, never operational.
    status: listed.get(selection.id)?.status ?? "unknown",
  }));

  const maintenances: MaintenanceWindow[] = parseBody(schedulesRaw, schedulesSchema, service, "schedules")
    .data.flatMap((schedule) => {
      const id = schedule.id;
      const startsAt = isoOf(schedule.scheduled_at);
      // A window with no id cannot be told from the next one, and one we cannot
      // place on a clock cannot silence anything.
      if (id === undefined || startsAt === null) return [];
      if (String(schedule.status ?? "") === SCHEDULE_COMPLETE) return [];
      return [
        {
          id: String(id),
          name: schedule.name ?? "",
          status: schedule.human_status ?? "",
          startsAt,
          // Cachet writes `completed_at` when the window is planned to end, and
          // leaves it null for one with no declared end.
          endsAt: isoOf(schedule.completed_at),
          componentIds: schedule.components
            .filter((component) => component.id !== undefined)
            .map((component) => String(component.id)),
        },
      ];
    });

  return {
    provider: service.id,
    // With nothing selected the whole component list is the page's own state,
    // which is the closest thing Cachet publishes to an aggregate word.
    overallStatus: scope === null ? worstOf(page.components) : worstOf(components),
    activeIncidents,
    components,
    maintenances,
    fetchedAt,
  };
}

/**
 * Pure mapping from the incident list to the timeline, exported for the tests.
 * A schedule is left out: this is the incident history, and a planned window is
 * not an incident.
 */
export function parseCachetHistory(incidentsRaw: string, service: ServiceRef): IncidentHistoryResult {
  const page = readPage("{}", incidentsRaw, service);
  const incidents: HistoricalIncident[] = page.incidents.flatMap((incident) => {
    const startedAt = incident.startedAt;
    // An incident we cannot place on a clock cannot go on a timeline.
    if (startedAt === null) return [];
    return [
      {
        id: incident.id,
        name: incident.name,
        impact: incident.status,
        status: incident.status,
        startedAt,
        // Cachet closes an incident by flag, not by timestamp, so its last
        // update is the only closure time the document offers.
        resolvedAt: incident.resolved ? incident.updatedAt : null,
        updatedAt: incident.updatedAt,
      },
    ];
  });

  const oldest = incidents.reduce<string | null>(
    (min, incident) => (min === null || incident.startedAt < min ? incident.startedAt : min),
    null,
  );

  // Never null: this is one page of the incident list, and what fell off the end
  // of it is exactly what this cannot account for.
  return { incidents, coverageStart: oldest };
}

/** Pure mapping from the component and group bodies to the picker's rows, exported for the tests. */
export function parseCachetComponents(componentsRaw: string, groupsRaw: string, service: ServiceRef): ComponentPreview[] {
  const groups = new Map(
    parseBody(groupsRaw, groupsSchema, service, "groups")
      .data.filter((group) => group.id !== undefined)
      .map((group) => [String(group.id), group.name ?? ""]),
  );

  return parseBody(componentsRaw, componentsSchema, service, "components")
    .data.filter((component) => component.id !== undefined)
    .filter((component) => component.enabled !== false)
    .map((component) => ({
      id: String(component.id),
      name: component.name ?? "",
      // Cachet writes 0 for an ungrouped component rather than leaving it out.
      group:
        component.group_id === undefined || String(component.group_id) === "0"
          ? null
          : (groups.get(String(component.group_id)) ?? null),
      // Cachet publishes no "featured" flag; the picker's hint simply has
      // nothing to go on here.
      showcase: false,
      status: mapComponentStatus(component.status),
    }));
}

async function readJson(path: string, service: ServiceRef, ctx: FetchContext): Promise<string> {
  return fetchConditional(`${service.baseUrl}${path}`, {
    // The cache is keyed by provider *and* url, so three paths under one id are
    // three entries — and `forgetProvider` still drops all three at once.
    providerId: service.id,
    accept: "application/json",
    timeoutMs: ctx.timeoutMs,
    onRead: ctx.onRead,
    label: "cachet fetch",
  });
}

export const cachetAdapter: Adapter = {
  id: "cachet",

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    // Three reads, because Cachet publishes the three halves of a status page in
    // three documents and none of them stands in for another. They revalidate
    // with `ETag` like every other read here, so a quiet cycle is three 304s.
    const [components, incidents, schedules] = await Promise.all([
      readJson(COMPONENTS_PATH, service, ctx),
      readJson(INCIDENTS_PATH, service, ctx),
      readJson(SCHEDULES_PATH, service, ctx),
    ]);
    return parseCachetStatus(components, incidents, schedules, service);
  },

  async fetchIncidentHistory(service: ServiceRef, ctx: FetchContext): Promise<IncidentHistoryResult> {
    return parseCachetHistory(await readJson(INCIDENTS_PATH, service, ctx), service);
  },

  async listComponents(service: ServiceRef, ctx: FetchContext): Promise<ComponentPreview[]> {
    const [components, groups] = await Promise.all([
      readJson(COMPONENTS_PATH, service, ctx),
      readJson(GROUPS_PATH, service, ctx),
    ]);
    return parseCachetComponents(components, groups, service);
  },
};
