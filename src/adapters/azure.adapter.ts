import type { Adapter, FetchContext, IncidentHistoryResult, ServiceRef } from "../core/adapter.interface.ts";
import { fetchConditional } from "../core/http.ts";
import type { HistoricalIncident, Incident, NormalizedStatus, OverallStatus } from "../core/types.ts";
import { parseFeed, type FeedEntry } from "./rss.adapter.ts";
import { severityFromWords, worstStatus } from "./severity.ts";

/**
 * Azure publishes no status JSON at all: the machine-readable half of
 * `azure.status.microsoft` is an RSS feed, and everything else is the HTML page.
 * So this adapter reads the feed — reusing the generic feed reader for the XML
 * itself — and adds the two things the generic adapter gets wrong about Azure.
 *
 * The first is vocabulary. Azure says "mitigated" where everyone else says
 * "resolved", and an entry announcing a mitigation read as open kept a
 * recovered region degraded for the whole active window.
 *
 * The second is that the feed is empty while Azure is healthy — it carries open
 * communications only, so there is nothing to read as "operational" and nothing
 * to backfill a timeline from beyond what is open now.
 *
 * `service.baseUrl` is the host; the feed path carries the locale, which is
 * `options.locale` (default `en-us`) because Azure publishes one feed per
 * locale and an operator reading the dashboard in Italian may still want the
 * English wording that the severity heuristic is written against.
 */

const DEFAULT_LOCALE = "en-us";

/** Accepted by the feed host and specific enough to skip the HTML variant. */
const ACCEPT = "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8";

/**
 * Azure's own words for "it is over". `mitigated`/`mitigation` are the ones the
 * generic feed adapter does not know; the rest are here so this adapter does not
 * quietly regress when the wording drifts back to the common vocabulary.
 */
const CLOSED = /\b(mitigat\w*|resolved|restored|recovered)\b/i;

/**
 * How long an open communication keeps counting as current. Azure leaves an
 * entry in the feed after the mitigation note, so the closure wording is the
 * primary signal and this is only the backstop for an entry that never got one.
 */
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

const feedPath = (service: ServiceRef): string =>
  `/${service.options?.["locale"] ?? DEFAULT_LOCALE}/status/feed/`;

const isClosed = (entry: FeedEntry): boolean => CLOSED.test(`${entry.title} ${entry.body}`);

function severityOf(entry: FeedEntry): OverallStatus {
  return severityFromWords(`${entry.title} ${entry.body}`);
}

function isOpen(entry: FeedEntry, now: Date): boolean {
  if (isClosed(entry)) return false;
  // An undated entry counts as current: a feed that omits the date must not read
  // as a recovery.
  if (entry.publishedAt === null) return true;
  return now.getTime() - Date.parse(entry.publishedAt) <= ACTIVE_WINDOW_MS;
}

/** Pure mapping from the feed to a status reading, exported for the tests. */
export function parseAzureStatus(xml: string, service: ServiceRef, now: Date = new Date()): NormalizedStatus {
  const open = parseFeed(xml, service.id).filter((entry) => entry.id !== null && isOpen(entry, now));
  const fetchedAt = new Date().toISOString();

  const activeIncidents: Incident[] = open.map((entry) => ({
    id: entry.id!,
    name: entry.title,
    impact: severityOf(entry),
    status: "open",
    updatedAt: entry.publishedAt ?? fetchedAt,
  }));

  return {
    provider: service.id,
    overallStatus: worstStatus(open.map(severityOf)),
    activeIncidents,
    // The feed has no per-service status list, only the service named in an
    // entry's title, so there is nothing a picker could offer.
    components: [],
    // Azure announces planned maintenance per subscription through Service
    // Health, not on the public feed.
    maintenances: [],
    fetchedAt,
  };
}

/**
 * Pure mapping from the same feed to the incident timeline. It reaches back only
 * as far as the feed does — which, for a provider that publishes open
 * communications only, is not far — so `coverageStart` is the oldest entry in it
 * rather than null.
 */
export function parseAzureHistory(xml: string, service: ServiceRef): IncidentHistoryResult {
  const incidents: HistoricalIncident[] = parseFeed(xml, service.id).flatMap((entry) => {
    if (entry.id === null || entry.publishedAt === null) return [];
    const closed = isClosed(entry);
    return [
      {
        id: entry.id,
        name: entry.title,
        impact: severityOf(entry),
        status: closed ? "mitigated" : "open",
        startedAt: entry.publishedAt,
        // The publication date of the mitigation note is the only closure
        // timestamp the feed carries.
        resolvedAt: closed ? entry.publishedAt : null,
        updatedAt: entry.publishedAt,
      },
    ];
  });

  const oldest = incidents.reduce<string | null>(
    (min, incident) => (min === null || incident.startedAt < min ? incident.startedAt : min),
    null,
  );

  return { incidents, coverageStart: oldest };
}

async function readFeed(service: ServiceRef, ctx: FetchContext): Promise<string> {
  return fetchConditional(`${service.baseUrl}${feedPath(service)}`, {
    providerId: service.id,
    accept: ACCEPT,
    timeoutMs: ctx.timeoutMs,
    label: "azure fetch",
  });
}

export const azureAdapter: Adapter = {
  id: "azure",

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    return parseAzureStatus(await readFeed(service, ctx), service);
  },

  async fetchIncidentHistory(service: ServiceRef, ctx: FetchContext): Promise<IncidentHistoryResult> {
    return parseAzureHistory(await readFeed(service, ctx), service);
  },
};
