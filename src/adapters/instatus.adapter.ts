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
import { worstStatus } from "./severity.ts";

/**
 * Instatus, the most common Statuspage competitor (roadmap 1.7).
 *
 * Two public endpoints, both JSON and both unauthenticated: `/summary.json` for
 * the page's own status plus its open incidents and declared maintenance
 * windows, and `/v3/components.json` for the component list. `service.baseUrl`
 * is the page's host (`https://status.gcore.com`), as with every other adapter.
 *
 * The component read is deliberately conditional on there being a selection to
 * resolve: a provider nobody has picked components for must not cost two
 * requests a cycle for a list nothing reads.
 *
 * Unlike Statuspage, `summary.json` does not attribute an incident to the
 * components it affects, so `scopeToComponents` narrows what is *reported* — the
 * component list and the overall status folded from it — but cannot drop an
 * incident. Every open incident stays, which is the safe direction: a scoped
 * provider going quiet about an outage is the failure worth avoiding.
 */

const SUMMARY_PATH = "/summary.json";
const COMPONENTS_PATH = "/v3/components.json";

const incidentSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  started: z.string().optional(),
  status: z.string().optional(),
  impact: z.string().optional(),
  updatedAt: z.string().optional(),
});

const maintenanceSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  start: z.string().optional(),
  status: z.string().optional(),
  /** Minutes. Instatus publishes a length, not an end timestamp. */
  duration: z.number().optional(),
  updatedAt: z.string().optional(),
});

const summarySchema = z.object({
  page: z
    .object({
      name: z.string().optional(),
      url: z.string().optional(),
      status: z.string().optional(),
    })
    .optional(),
  activeIncidents: z.array(incidentSchema).default([]),
  activeMaintenances: z.array(maintenanceSchema).default([]),
});

const componentsSchema = z.object({
  components: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().optional(),
        status: z.string().optional(),
        /** Present and null for an ungrouped component. */
        group: z.object({ id: z.string().optional(), name: z.string().optional() }).nullable().optional(),
      }),
    )
    .default([]),
});

/**
 * Instatus's severity vocabulary, shared by an incident's `impact` and a
 * component's `status`. `UNDERMAINTENANCE` maps to `unknown` for the same
 * reason the Statuspage adapter's `under_maintenance` does: the normalized
 * model has no maintenance state, and `unknown` abstains in the diff engine
 * rather than reading as a recovery.
 */
const IMPACTS: Record<string, OverallStatus> = {
  OPERATIONAL: "operational",
  DEGRADEDPERFORMANCE: "degraded",
  PARTIALOUTAGE: "partial_outage",
  MAJOROUTAGE: "major_outage",
  UNDERMAINTENANCE: "unknown",
};

/** The page-wide word. `HASISSUES` says something is wrong without saying what. */
const PAGE_STATUSES: Record<string, OverallStatus> = {
  UP: "operational",
  HASISSUES: "degraded",
  UNDERMAINTENANCE: "unknown",
};

/** Instatus lifecycle words for a window that is over. */
const CLOSED_MAINTENANCE = new Set(["COMPLETED"]);

/**
 * A word we have never seen is treated as the worst case, exactly as the
 * Statuspage adapter treats an unknown indicator: silently downgrading an
 * outage to operational is the one failure mode that matters.
 */
function mapWord(word: string | undefined, table: Record<string, OverallStatus>): OverallStatus {
  if (word === undefined || word === "") return "unknown";
  return table[word.toUpperCase()] ?? "major_outage";
}

/** Throws when the body is not Instatus's payload — the poller's retry accounting depends on it. */
function parseBody<S extends z.ZodTypeAny>(raw: string, schema: S, service: ServiceRef, shape: string): z.infer<S> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`instatus fetch for ${service.id} returned a body that is not JSON`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`instatus fetch for ${service.id} returned a body that is not a ${shape} payload`);
  }
  return parsed.data;
}

/** The end of a window, from the length Instatus publishes instead of one. */
function endOf(startsAt: string, duration: number | undefined): string | null {
  if (duration === undefined) return null;
  const startedMs = Date.parse(startsAt);
  if (Number.isNaN(startedMs)) return null;
  return new Date(startedMs + duration * 60_000).toISOString();
}

/** Pure mapping from a `/summary.json` body to a reading, exported for the tests. */
export function parseInstatusSummary(raw: string, service: ServiceRef): NormalizedStatus {
  const parsed = parseBody(raw, summarySchema, service, "summary");
  const fetchedAt = new Date().toISOString();

  const open = parsed.activeIncidents.filter((entry) => entry.id !== undefined);
  const activeIncidents: Incident[] = open.map((entry) => ({
    id: entry.id as string,
    name: entry.name ?? "",
    // The provider's own words for both, unnormalised, so a notifier can quote
    // Instatus rather than us.
    impact: entry.impact ?? "",
    status: entry.status ?? "",
    updatedAt: entry.updatedAt ?? entry.started ?? fetchedAt,
  }));

  const maintenances: MaintenanceWindow[] = parsed.activeMaintenances.flatMap((entry) => {
    const id = entry.id;
    const start = entry.start;
    // A window with no id cannot be told from the next one, and one we cannot
    // place on a clock cannot silence anything.
    if (id === undefined || start === undefined) return [];
    if (CLOSED_MAINTENANCE.has((entry.status ?? "").toUpperCase())) return [];
    const startedMs = Date.parse(start);
    if (Number.isNaN(startedMs)) return [];
    const startsAt = new Date(startedMs).toISOString();
    return [
      {
        id,
        name: entry.name ?? "",
        status: entry.status ?? "",
        startsAt,
        endsAt: endOf(startsAt, entry.duration),
        // Instatus's summary does not say which components a window covers.
        componentIds: [],
      },
    ];
  });

  // The incidents are the dial, with the page's own word as a floor: a page
  // left saying `UP` with an incident open reads as trouble, and one saying
  // `HASISSUES` while listing none still reads as trouble.
  const floor = mapWord(parsed.page?.status, PAGE_STATUSES);
  const overallStatus =
    open.length === 0
      ? floor
      : worstStatus([
          ...(floor === "unknown" ? [] : [floor]),
          ...open.map((entry) => mapWord(entry.impact, IMPACTS)).filter((status) => status !== "unknown"),
        ]);

  return { provider: service.id, overallStatus, activeIncidents, components: [], maintenances, fetchedAt };
}

/** Pure mapping from a `/v3/components.json` body to the picker's rows, exported for the tests. */
export function parseInstatusComponents(raw: string, service: ServiceRef): ComponentPreview[] {
  return parseBody(raw, componentsSchema, service, "components")
    .components.filter((component) => component.id !== undefined)
    .map((component) => ({
      id: component.id as string,
      name: component.name ?? "",
      group: component.group?.name ?? null,
      // Instatus publishes no "featured" flag; the picker's hint simply has
      // nothing to go on here.
      showcase: false,
      status: mapWord(component.status, IMPACTS),
    }));
}

/** The operator's selection, resolved against what the page currently lists. */
function selectedComponents(previews: ComponentPreview[], service: ServiceRef): ComponentStatus[] {
  const listed = new Map(previews.map((preview) => [preview.id, preview]));
  return (service.components ?? []).map((selection) => ({
    id: selection.id,
    // The provider's current name wins; the stored one is the fallback for a
    // component the page has since dropped or renamed away.
    name: listed.get(selection.id)?.name ?? selection.name,
    // A selection the page no longer lists reads `unknown`, never operational:
    // a component that vanished is not a recovery.
    status: listed.get(selection.id)?.status ?? "unknown",
  }));
}

/** Severity worst last. `unknown` is absent: it ranks nowhere, it only abstains. */
const SEVERITY: OverallStatus[] = ["operational", "degraded", "partial_outage", "major_outage"];

/** The worst status any selected component reports, `unknown` when none does. */
function worstOf(components: ComponentStatus[]): OverallStatus {
  const worst = components.reduce((rank, component) => Math.max(rank, SEVERITY.indexOf(component.status)), -1);
  return SEVERITY[worst] ?? "unknown";
}

async function readJson(path: string, service: ServiceRef, ctx: FetchContext): Promise<string> {
  return fetchConditional(`${service.baseUrl}${path}`, {
    providerId: service.id,
    accept: "application/json",
    timeoutMs: ctx.timeoutMs,
    onRead: ctx.onRead,
    label: "instatus fetch",
  });
}

export const instatusAdapter: Adapter = {
  id: "instatus",

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    const status = parseInstatusSummary(await readJson(SUMMARY_PATH, service, ctx), service);
    const selection = service.components ?? [];
    if (selection.length === 0) return status;

    // Only now is the second endpoint worth a request: there is a selection to
    // resolve against it.
    const previews = parseInstatusComponents(await readJson(COMPONENTS_PATH, service, ctx), service);
    const components = selectedComponents(previews, service);
    if (service.scopeToComponents !== true) return { ...status, components };

    // Scoping folds the reading out of the selection instead of the page's own
    // word. The incidents are left alone — Instatus does not attribute them to
    // components, so there is nothing to scope them by (see the file's header).
    return { ...status, components, overallStatus: worstOf(components) };
  },

  async listComponents(service: ServiceRef, ctx: FetchContext): Promise<ComponentPreview[]> {
    return parseInstatusComponents(await readJson(COMPONENTS_PATH, service, ctx), service);
  },

  // No `fetchIncidentHistory`: Instatus publishes no public JSON history
  // endpoint — only an RSS feed, which the `rss` adapter already reads for
  // anyone who wants a provider's timeline backfilled from one.
};
