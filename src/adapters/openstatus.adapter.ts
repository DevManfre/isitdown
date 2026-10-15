import { z } from "zod";
import type { Adapter, FetchContext, ServiceRef } from "../core/adapter.interface.ts";
import type { NormalizedStatus, OverallStatus } from "../core/types.ts";
import { fetchConditional } from "../core/http.ts";

/**
 * An OpenStatus status page (roadmap 2.12), read through its public endpoint,
 * `GET https://api.openstatus.dev/public/status/<slug>`, which answers one word.
 *
 * `service.baseUrl` is the page's slug url or the API origin: the slug is taken
 * from `options.slug`, else from the first label of the page's host
 * (`openstatus.openstatus.dev` -> `openstatus`) — the form OpenStatus hosts
 * pages on. `options.apiBase` points at a self-hosted API.
 *
 * The public endpoint carries only the aggregate: no components, no incidents.
 * Reporting none is the honest reading, so the diff engine alerts on the word
 * changing and says nothing about why.
 *
 * A word nothing here knows reads as the worst case, like every adapter.
 */
const WORDS: Record<string, OverallStatus> = {
  operational: "operational",
  degraded_performance: "degraded",
  degraded: "degraded",
  partial_outage: "partial_outage",
  major_outage: "major_outage",
  incident: "partial_outage",
  // The normalized model has no maintenance state; `unknown` abstains in the
  // diff engine's recovery check, as Statuspage's `under_maintenance` does.
  under_maintenance: "unknown",
  unknown: "unknown",
};

const bodySchema = z.object({ status: z.string() });

export function parseOpenStatus(raw: string, service: ServiceRef): NormalizedStatus {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`openstatus fetch ${service.id}: the body is not JSON`);
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) throw new Error(`openstatus fetch ${service.id}: not an OpenStatus status document`);
  return {
    provider: service.id,
    overallStatus: WORDS[parsed.data.status] ?? "major_outage",
    activeIncidents: [],
    components: [],
    maintenances: [],
    fetchedAt: new Date().toISOString(),
  };
}

/** The endpoint for the page the operator has open in their browser. */
export function endpointOf(service: ServiceRef): string {
  const apiBase = (service.options?.["apiBase"] ?? "").trim().replace(/\/+$/, "") || "https://api.openstatus.dev";
  let slug = (service.options?.["slug"] ?? "").trim();
  if (slug === "") {
    try {
      slug = new URL(service.baseUrl).hostname.split(".")[0] ?? "";
    } catch {
      slug = "";
    }
  }
  if (slug === "") throw new Error(`openstatus fetch ${service.id}: no page slug, set options.slug`);
  return `${apiBase}/public/status/${encodeURIComponent(slug)}`;
}

export const openStatusAdapter: Adapter = {
  id: "openstatus",
  version: 1,

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    const raw = await fetchConditional(endpointOf(service), {
      providerId: service.id,
      accept: "application/json",
      timeoutMs: ctx.timeoutMs,
      onRead: ctx.onRead,
      auth: service.options,
      label: "openstatus fetch",
    });
    return parseOpenStatus(raw, service);
  },
};
