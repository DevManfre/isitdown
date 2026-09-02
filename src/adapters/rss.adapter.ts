import type { Adapter, FetchContext, IncidentHistoryResult, ServiceRef } from "../core/adapter.interface.ts";
import type { HistoricalIncident, Incident, NormalizedStatus, OverallStatus } from "../core/types.ts";

/**
 * The generic adapter for the long tail of status pages that publish a feed and
 * nothing else. One adapter, configured by feed URL alone: `service.baseUrl` is
 * the feed itself, not a base to append a path to.
 *
 * A feed carries incident announcements, never an overall status, so the status
 * is derived: an entry counts as open while it is recent and has not announced
 * its own closure, and its severity is read from the words the provider used.
 * That is a heuristic, and it is deliberately pessimistic — an entry we cannot
 * date or classify reads as trouble, never as recovery.
 */

/** How long an entry keeps counting as an open incident. */
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Accepted by every feed host and specific enough to skip an HTML variant. */
const ACCEPT = "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8";

/** Both feed dialects, with or without a namespace prefix on every tag. */
const ROOT = /<(?:[A-Za-z0-9_-]+:)?(?:rss|feed)[\s>]/i;
const ENTRY = /<(?:[A-Za-z0-9_-]+:)?(?:item|entry)[\s>][\s\S]*?<\/(?:[A-Za-z0-9_-]+:)?(?:item|entry)>/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isNaN(code) ? whole : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** CDATA is literal by definition; everything else has its entities resolved. */
function textOf(raw: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw);
  return cdata === null ? decodeEntities(raw).trim() : cdata[1]!.trim();
}

/** First occurrence of a tag inside one entry, whatever namespace it wears. */
function tag(block: string, name: string): string | null {
  const match = new RegExp(`<(?:[A-Za-z0-9_-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_-]+:)?${name}>`, "i").exec(
    block,
  );
  return match === null ? null : textOf(match[1]!);
}

/**
 * Atom writes the link as an attribute on a self-closing tag; RSS writes it as
 * the tag's text. Both are the only stable identifier some feeds offer.
 */
function linkOf(block: string): string | null {
  const inline = tag(block, "link");
  if (inline !== null && inline !== "") return inline;
  const href = /<(?:[A-Za-z0-9_-]+:)?link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(block);
  return href === null ? null : decodeEntities(href[1]!);
}

function dateOf(block: string): string | null {
  for (const name of ["pubDate", "published", "updated", "date"]) {
    const raw = tag(block, name);
    if (raw === null || raw === "") continue;
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

export interface FeedEntry {
  /** The provider's own identifier; null when the feed offers none. */
  id: string | null;
  title: string;
  /** Description, summary or content — whichever the feed carries. */
  body: string;
  /** ISO 8601, or null when the entry is undated. */
  publishedAt: string | null;
}

/**
 * Reads the entries out of an RSS 2.0 or Atom document. Exported so the mapping
 * can be exercised with no network at all.
 *
 * Throws when the body is not a feed — an HTML login page or an error blob must
 * reach the poller as a failure, not as a provider with nothing to report.
 */
export function parseFeed(xml: string, provider = "rss"): FeedEntry[] {
  if (!ROOT.test(xml)) throw new Error(`feed for ${provider} is not RSS or Atom`);
  return [...xml.matchAll(ENTRY)].map((match) => {
    const block = match[0];
    return {
      id: tag(block, "guid") ?? tag(block, "id") ?? linkOf(block),
      title: tag(block, "title") ?? "",
      body: tag(block, "description") ?? tag(block, "summary") ?? tag(block, "content") ?? "",
      publishedAt: dateOf(block),
    };
  });
}

/**
 * Words a provider uses to say an incident is over. Checked before severity: an
 * entry titled "Resolved: major outage" is history, not an outage.
 */
const CLOSED = /\b(resolved|completed|restored|closed)\b/i;

/**
 * Severity by wording, worst first, with `partial` ahead of the outage words it
 * contains. An entry matching nothing still reads `degraded`: the provider
 * thought it worth announcing, so it is never nothing.
 */
const SEVERITIES: [RegExp, OverallStatus][] = [
  [/\bpartial\b/i, "partial_outage"],
  [/\b(outage|down|offline|unavailable|unreachable|not working)\b/i, "major_outage"],
];

function severityOf(entry: FeedEntry): OverallStatus {
  const text = `${entry.title} ${entry.body}`;
  return SEVERITIES.find(([pattern]) => pattern.test(text))?.[1] ?? "degraded";
}

/**
 * Whether an entry is still speaking about now. An undated entry counts as
 * recent: a feed that omits the date must not read as a recovery.
 */
function isOpen(entry: FeedEntry, now: Date): boolean {
  if (CLOSED.test(`${entry.title} ${entry.body}`)) return false;
  if (entry.publishedAt === null) return true;
  return now.getTime() - Date.parse(entry.publishedAt) <= ACTIVE_WINDOW_MS;
}

/** Severity worst last, so the worst open entry decides the provider's reading. */
const RANK: OverallStatus[] = ["operational", "degraded", "partial_outage", "major_outage"];

/** Pure mapping from a feed body to a status reading, exported for the tests. */
export function parseFeedStatus(xml: string, service: ServiceRef, now: Date = new Date()): NormalizedStatus {
  const open = parseFeed(xml, service.id).filter((entry) => entry.id !== null && isOpen(entry, now));
  const fetchedAt = new Date().toISOString();

  const activeIncidents: Incident[] = open.map((entry) => ({
    id: entry.id!,
    name: entry.title,
    impact: severityOf(entry),
    status: "open",
    updatedAt: entry.publishedAt ?? fetchedAt,
  }));

  const worst = open.reduce((rank, entry) => Math.max(rank, RANK.indexOf(severityOf(entry))), 0);

  return {
    provider: service.id,
    overallStatus: RANK[worst]!,
    activeIncidents,
    // A feed has no components; the picker is told so by the missing
    // `listComponents`, and a selection made elsewhere cannot be honoured here.
    components: [],
    // A feed has no structured maintenance data either.
    maintenances: [],
    fetchedAt,
  };
}

/**
 * Pure mapping from a feed body to the incident timeline, exported for the
 * tests. An undated entry is dropped: it cannot be placed on a timeline, and
 * inventing a date for it would put a false bar on the chart.
 */
export function parseFeedHistory(xml: string, service: ServiceRef): IncidentHistoryResult {
  const incidents: HistoricalIncident[] = parseFeed(xml, service.id).flatMap((entry) => {
    if (entry.id === null || entry.publishedAt === null) return [];
    // The window is what makes an entry current, not what makes it real: on the
    // timeline an entry is closed only once the provider says it is.
    const closed = CLOSED.test(`${entry.title} ${entry.body}`);
    return [
      {
        id: entry.id,
        name: entry.title,
        impact: severityOf(entry),
        status: closed ? "resolved" : "open",
        startedAt: entry.publishedAt,
        // The announcement is the only timestamp a feed gives for a closure.
        resolvedAt: closed ? entry.publishedAt : null,
        updatedAt: entry.publishedAt,
      },
    ];
  });

  const oldest = incidents.reduce<string | null>(
    (min, incident) => (min === null || incident.startedAt < min ? incident.startedAt : min),
    null,
  );

  // Never null: a feed is a window onto a history, and what rolled off the end
  // of it is exactly what it cannot account for.
  return { incidents, coverageStart: oldest };
}

async function readFeed(service: ServiceRef, ctx: FetchContext): Promise<string> {
  const response = await fetch(service.baseUrl, {
    headers: { accept: ACCEPT },
    signal: AbortSignal.timeout(ctx.timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`rss fetch for ${service.id} failed: HTTP ${response.status}`);
  }
  return response.text();
}

export const rssAdapter: Adapter = {
  id: "rss",

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    return parseFeedStatus(await readFeed(service, ctx), service);
  },

  async fetchIncidentHistory(service: ServiceRef, ctx: FetchContext): Promise<IncidentHistoryResult> {
    return parseFeedHistory(await readFeed(service, ctx), service);
  },
};
