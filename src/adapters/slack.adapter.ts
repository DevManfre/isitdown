import { z } from "zod";
import type { Adapter, FetchContext, IncidentHistoryResult, ServiceRef } from "../core/adapter.interface.ts";
import type { HistoricalIncident, Incident, NormalizedStatus } from "../core/types.ts";
import { fetchConditional } from "../core/http.ts";
import { severityFromWords, worstStatus } from "./severity.ts";

/**
 * Slack publishes its own small JSON API rather than running on Statuspage:
 * `/api/v2.0.0/current` for what is open now, `/api/v2.0.0/history` for the
 * timeline. `service.baseUrl` is the host (`https://slack-status.com`) and the
 * endpoint path is appended, as with the Statuspage adapter.
 *
 * The payload carries no severity field at all — an incident is a title, a
 * lifecycle word and a list of affected service names — so the severity is read
 * from the provider's own wording, the same heuristic the feed adapter uses.
 * The provider's top-level `status` word is deliberately not the dial: the
 * incident list is, so a page left saying `ok` with an incident still open
 * reads as trouble rather than as calm.
 */

const CURRENT_PATH = "/api/v2.0.0/current";
const HISTORY_PATH = "/api/v2.0.0/history";

/**
 * A "notice" is Slack's informational entry (an upcoming change, an advisory).
 * It is still surfaced as an incident so the operator sees it, but on its own it
 * does not move the provider's status: an announcement is not an outage.
 */
const INFORMATIONAL = "notice";

/**
 * Every field but the id is optional. The id is what everything downstream
 * tracks an incident by, so an entry without one is dropped rather than given
 * an invented one.
 */
const entrySchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  title: z.string().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  date_created: z.string().optional(),
  date_updated: z.string().optional(),
});

const currentSchema = z.object({
  status: z.string().optional(),
  active_incidents: z.array(entrySchema).default([]),
});

const historySchema = z.array(entrySchema);

type SlackEntry = z.infer<typeof entrySchema>;

/**
 * Throws when the body is not Slack's payload at all — an HTML error page or
 * another provider's JSON must reach the poller as a failure, not as a provider
 * with nothing to report.
 */
function parseBody<S extends z.ZodTypeAny>(raw: string, schema: S, service: ServiceRef, shape: string): z.infer<S> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`slack fetch for ${service.id} returned a body that is not JSON`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`slack fetch for ${service.id} returned a body that is not a ${shape} payload`);
  }
  return parsed.data;
}

/** Slack answers in its own offset (-07:00); everything downstream is UTC. */
function toUtc(raw: string | undefined): string | null {
  if (raw === undefined || raw === "") return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function severityOf(entry: SlackEntry): ReturnType<typeof severityFromWords> {
  return severityFromWords(entry.title ?? "");
}

/** Pure mapping from a `/current` body to a status reading, exported for the tests. */
export function parseSlackStatus(raw: string, service: ServiceRef): NormalizedStatus {
  const open = parseBody(raw, currentSchema, service, "current-status").active_incidents.filter(
    (entry) => entry.id !== undefined,
  );
  const fetchedAt = new Date().toISOString();

  const activeIncidents: Incident[] = open.map((entry) => ({
    id: String(entry.id),
    name: entry.title ?? "",
    impact: severityOf(entry),
    // Slack's own lifecycle word ("active"), kept unnormalised like every other
    // adapter's, so a notifier can quote the provider rather than us.
    status: entry.status ?? "active",
    updatedAt: toUtc(entry.date_updated) ?? toUtc(entry.date_created) ?? fetchedAt,
  }));

  return {
    provider: service.id,
    overallStatus: worstStatus(open.filter((entry) => entry.type !== INFORMATIONAL).map(severityOf)),
    activeIncidents,
    // Slack names the affected services on an incident but publishes no
    // per-service status list, so there is nothing a component picker could
    // offer and nothing a selection could be resolved against.
    components: [],
    // Nor any scheduled-maintenance data: an entry announcing one carries no
    // window bounds, so it stays an incident rather than becoming a window that
    // would silence the provider for as long as it sat there.
    maintenances: [],
    fetchedAt,
  };
}

/**
 * Pure mapping from a `/history` body to the incident timeline, exported for the
 * tests. An entry with no start date is dropped: it cannot be placed on a
 * timeline, and inventing a date for it would put a false bar on the chart.
 */
export function parseSlackHistory(raw: string, service: ServiceRef): IncidentHistoryResult {
  const incidents: HistoricalIncident[] = parseBody(raw, historySchema, service, "incident-history").flatMap(
    (entry) => {
      const startedAt = toUtc(entry.date_created);
      if (entry.id === undefined || startedAt === null) return [];
      const updatedAt = toUtc(entry.date_updated) ?? startedAt;
      const resolved = entry.status === "resolved";
      return [
        {
          id: String(entry.id),
          name: entry.title ?? "",
          impact: severityOf(entry),
          status: entry.status ?? "active",
          startedAt,
          // The last update is the only timestamp the API gives for a closure.
          resolvedAt: resolved ? updatedAt : null,
          updatedAt,
        },
      ];
    },
  );

  const oldest = incidents.reduce<string | null>(
    (min, incident) => (min === null || incident.startedAt < min ? incident.startedAt : min),
    null,
  );

  // Never null: the endpoint is a window onto a history, and what rolled off the
  // end of it is exactly what it cannot account for.
  return { incidents, coverageStart: oldest };
}

async function readJson(path: string, service: ServiceRef, ctx: FetchContext): Promise<string> {
  return fetchConditional(`${service.baseUrl}${path}`, {
    providerId: service.id,
    accept: "application/json",
    timeoutMs: ctx.timeoutMs,
    label: "slack fetch",
  });
}

export const slackAdapter: Adapter = {
  id: "slack",

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    return parseSlackStatus(await readJson(CURRENT_PATH, service, ctx), service);
  },

  async fetchIncidentHistory(service: ServiceRef, ctx: FetchContext): Promise<IncidentHistoryResult> {
    return parseSlackHistory(await readJson(HISTORY_PATH, service, ctx), service);
  },
};
