import { z } from "zod";
import type { Adapter, ComponentPreview, FetchContext, ServiceRef } from "../core/adapter.interface.ts";
import type { ComponentStatus, Incident, NormalizedStatus, OverallStatus } from "../core/types.ts";
import { fetchConditional } from "../core/http.ts";

/**
 * A cState status page (roadmap 2.12) — the Hugo-built static page self-hosters
 * run — through its read-only API, `<page>/index.json` (API v2.0).
 *
 * cState's words are `ok`, `disrupted` and `down`, per system and for the page
 * (`summaryStatus`). The page's own summary is used as published; a system
 * carries no id, so its name is the id. Open issues are the `unresolvedIssues`
 * each system lists, de-duplicated by permalink; pinned *informational* notices
 * are announcements, not incidents, and are left out.
 *
 * The JSON is generated like a HTML page and the project documents that it may
 * hold `<no value>` where a field is empty, so any string of that kind is
 * treated as absent.
 */
const WORDS: Record<string, OverallStatus> = { ok: "operational", disrupted: "degraded", down: "major_outage" };

const stateOf = (word: string | undefined): OverallStatus =>
  word === undefined || word === "" || word === "<no value>" ? "unknown" : (WORDS[word] ?? "major_outage");

const issueSchema = z.union([
  z.string(),
  z.object({
    title: z.string().optional(),
    permalink: z.string().optional(),
    createdAt: z.string().optional(),
    lastMod: z.string().optional(),
    severity: z.string().optional(),
  }),
]);

const bodySchema = z.object({
  summaryStatus: z.string().optional(),
  systems: z.array(z.object({ name: z.string(), category: z.string().optional(), status: z.string().optional(), unresolvedIssues: z.array(issueSchema).default([]) })),
});

/** cState's date strings (`2024-02-24 10:35:00 +0000 UTC`) as ISO, null when unreadable. */
function isoOf(stamp: string | undefined): string | null {
  if (stamp === undefined) return null;
  const parsed = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?: ([+-]\d{4}))?/.exec(stamp);
  if (parsed === null) return null;
  const offset = parsed[3] === undefined ? "Z" : `${parsed[3].slice(0, 3)}:${parsed[3].slice(3)}`;
  const date = new Date(`${parsed[1]}T${parsed[2]}${offset}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parse(raw: string, service: ServiceRef): z.infer<typeof bodySchema> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`cstate fetch ${service.id}: the body is not JSON`);
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) throw new Error(`cstate fetch ${service.id}: not a cState index.json`);
  return parsed.data;
}

function scoped(service: ServiceRef): boolean {
  return service.scopeToComponents === true && (service.components ?? []).length > 0;
}

function worstKnown(statuses: OverallStatus[]): OverallStatus {
  const rank: Record<OverallStatus, number> = { unknown: 0, operational: 1, degraded: 2, partial_outage: 3, major_outage: 4 };
  return statuses.reduce<OverallStatus>((worst, next) => (rank[next] > rank[worst] ? next : worst), "unknown");
}

/** Pure mapping from index.json to a reading, exported for the tests. */
export function parseCState(raw: string, service: ServiceRef): NormalizedStatus {
  const body = parse(raw, service);
  const fetchedAt = new Date().toISOString();
  const listed = new Map(body.systems.map((system) => [system.name, system]));
  const components: ComponentStatus[] = (service.components ?? []).map((selection) => ({
    id: selection.id,
    name: selection.name,
    status: stateOf(listed.get(selection.id)?.status),
  }));

  const seen = new Set<string>();
  const activeIncidents: Incident[] = [];
  for (const system of body.systems) {
    for (const issue of system.unresolvedIssues) {
      const entry = typeof issue === "string" ? { title: issue } : issue;
      const id = entry.permalink ?? entry.title ?? "";
      if (id === "" || seen.has(id)) continue;
      seen.add(id);
      const created = isoOf(entry.createdAt);
      activeIncidents.push({
        id,
        name: entry.title ?? "",
        impact: entry.severity !== undefined && entry.severity !== "<no value>" ? entry.severity : "",
        status: "unresolved",
        updatedAt: isoOf(entry.lastMod) ?? created ?? fetchedAt,
        ...(created !== null ? { createdAt: created } : {}),
      });
    }
  }

  return {
    provider: service.id,
    overallStatus: scoped(service) ? worstKnown(components.map((c) => c.status)) : stateOf(body.summaryStatus),
    activeIncidents,
    components,
    maintenances: [],
    fetchedAt,
  };
}

/** Pure mapping from index.json to the picker's rows. */
export function parseCStateComponents(raw: string, service: ServiceRef): ComponentPreview[] {
  return parse(raw, service).systems.map((system) => ({
    id: system.name,
    name: system.name,
    group: system.category ?? null,
    showcase: false,
    status: stateOf(system.status),
  }));
}

async function read(service: ServiceRef, ctx: FetchContext): Promise<string> {
  const base = service.baseUrl.replace(/\/+$/, "").replace(/\/index\.json$/, "");
  return fetchConditional(`${base}/index.json`, {
    providerId: service.id,
    accept: "application/json",
    timeoutMs: ctx.timeoutMs,
    onRead: ctx.onRead,
    auth: service.options,
    label: "cstate fetch",
  });
}

export const cStateAdapter: Adapter = {
  id: "cstate",
  version: 1,

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    return parseCState(await read(service, ctx), service);
  },

  async listComponents(service: ServiceRef, ctx: FetchContext): Promise<ComponentPreview[]> {
    return parseCStateComponents(await read(service, ctx), service);
  },
};
