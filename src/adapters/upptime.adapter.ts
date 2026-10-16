import { z } from "zod";
import type { Adapter, ComponentPreview, FetchContext, ServiceRef } from "../core/adapter.interface.ts";
import type { ComponentStatus, NormalizedStatus, OverallStatus } from "../core/types.ts";
import { fetchConditional } from "../core/http.ts";

/**
 * An Upptime status page (roadmap 2.12) — the GitHub-Actions-driven monitor
 * self-hosters publish from a repository.
 *
 * Upptime has no server to ask: the repo commits `history/summary.json`, one
 * entry per monitored site with its current word (`up`, `down`, `degraded`).
 * That file is the page's own data, so it is what is read, from
 * raw.githubusercontent.com.
 *
 * `service.baseUrl` is the repository — `https://github.com/owner/repo` — or the
 * raw base (`https://raw.githubusercontent.com/owner/repo`) for a mirror or a
 * test. `options.branch` names the branch when it is not the repo's default
 * (`HEAD` follows the default).
 *
 * Upptime opens a GitHub issue per outage, but those are the repo's issues, not
 * a field of the summary, so no incident is reported: the sites' states are the
 * reading, same as Uptime Kuma. Overall is folded the way that adapter does:
 * everything down is major, some down partial, any degraded degraded.
 */
const siteSchema = z.object({
  name: z.string().optional(),
  slug: z.string().optional(),
  status: z.string().optional(),
});

const summarySchema = z.array(siteSchema);

const SITE_STATUSES: Record<string, OverallStatus> = {
  up: "operational",
  degraded: "degraded",
  down: "major_outage",
};

/** A word Upptime does not use reads as the worst case, like every adapter here. */
function mapSite(word: string | undefined): OverallStatus {
  if (word === undefined || word === "") return "unknown";
  return SITE_STATUSES[word.toLowerCase()] ?? "major_outage";
}

function parseBody(raw: string, service: ServiceRef): z.infer<typeof summarySchema> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`upptime fetch ${service.id}: the body is not JSON`);
  }
  const parsed = summarySchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`upptime fetch ${service.id}: not an Upptime summary (${parsed.error.issues[0]?.message ?? "unreadable"})`);
  }
  return parsed.data;
}

interface Site {
  id: string;
  name: string;
  status: OverallStatus;
}

function sitesOf(sites: z.infer<typeof summarySchema>): Site[] {
  return sites.flatMap((site) => {
    const id = site.slug ?? site.name;
    return id === undefined ? [] : [{ id, name: site.name ?? id, status: mapSite(site.status) }];
  });
}

function fold(statuses: OverallStatus[]): OverallStatus {
  const known = statuses.filter((status) => status !== "unknown");
  if (known.length === 0) return "unknown";
  const down = known.filter((status) => status === "major_outage").length;
  if (down === known.length) return "major_outage";
  if (down > 0) return "partial_outage";
  return known.some((status) => status === "degraded") ? "degraded" : "operational";
}

function scoped(service: ServiceRef): boolean {
  return service.scopeToComponents === true && (service.components ?? []).length > 0;
}

/** Pure mapping from the summary to a reading, exported for the tests. */
export function parseUpptimeStatus(raw: string, service: ServiceRef): NormalizedStatus {
  const sites = sitesOf(parseBody(raw, service));
  const listed = new Map(sites.map((site) => [site.id, site]));
  const components: ComponentStatus[] = (service.components ?? []).map((selection) => ({
    id: selection.id,
    name: listed.get(selection.id)?.name ?? selection.name,
    status: listed.get(selection.id)?.status ?? "unknown",
  }));
  return {
    provider: service.id,
    overallStatus: fold((scoped(service) ? components : sites).map((site) => site.status)),
    activeIncidents: [],
    components,
    maintenances: [],
    fetchedAt: new Date().toISOString(),
  };
}

/** Pure mapping from the summary to the picker's rows, exported for the tests. */
export function parseUpptimeComponents(raw: string, service: ServiceRef): ComponentPreview[] {
  return sitesOf(parseBody(raw, service)).map((site) => ({
    id: site.id,
    name: site.name,
    group: null,
    showcase: false,
    status: site.status,
  }));
}

/** The url the summary lives at, from the repository url the operator has open. */
export function summaryUrl(service: ServiceRef): string {
  const base = service.baseUrl.replace(/\/+$/, "").replace(/\.git$/, "");
  const branch = (service.options?.["branch"] ?? "").trim() || "HEAD";
  const repo = /^https?:\/\/github\.com\/([^/]+\/[^/]+)$/.exec(base);
  const root = repo !== null ? `https://raw.githubusercontent.com/${repo[1]}` : base;
  return `${root}/${branch}/history/summary.json`;
}

async function read(service: ServiceRef, ctx: FetchContext): Promise<string> {
  return fetchConditional(summaryUrl(service), {
    providerId: service.id,
    accept: "application/json",
    timeoutMs: ctx.timeoutMs,
    onRead: ctx.onRead,
    auth: service.options,
    label: "upptime fetch",
  });
}

export const upptimeAdapter: Adapter = {
  id: "upptime",
  version: 1,

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    return parseUpptimeStatus(await read(service, ctx), service);
  },

  async listComponents(service: ServiceRef, ctx: FetchContext): Promise<ComponentPreview[]> {
    return parseUpptimeComponents(await read(service, ctx), service);
  },
};
