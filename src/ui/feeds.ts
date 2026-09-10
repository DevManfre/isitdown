import type { IncidentRow } from "./historyStore.interface.ts";

/**
 * The incident history as a feed — roadmap 4.9.
 *
 * The same rows the list and the CSV export already serve, in the two shapes a
 * reader or a calendar consumes without an API client: RSS 2.0 and iCalendar.
 * They read the incident search's own filter (`readIncidentQuery`) like the
 * exports do, so a subscribed URL keeps answering the question it was copied
 * from.
 *
 * Both formats are assembled by hand rather than with a library. They are a few
 * hundred bytes of well-specified text, and this project's pitch is three
 * runtime dependencies.
 */

export interface FeedInput {
  /** Newest first, as every incident query returns them. */
  rows: IncidentRow[];
  /** A provider's display name; the feed is read by people, not by the API. */
  nameFor: (providerId: string) => string;
  /** `http://host:port` of the dashboard, so an item can link back into it. */
  origin: string;
  generatedAt: Date;
  /** The feed's own url, which a reader stores to poll. */
  self: string;
}

const TITLE = "IsItDown incidents";
const DESCRIPTION = "Incidents observed on the status pages IsItDown watches";

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/** An incident name is arbitrary upstream text and lands inside an element. */
const xml = (value: string): string => value.replaceAll(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);

/** `#/incidents/github/i1` — the dashboard's own hash route for one incident. */
const linkFor = (origin: string, row: IncidentRow): string =>
  `${origin}/#/incidents/${row.providerId}/${row.incidentId}`;

const titleFor = (input: FeedInput, row: IncidentRow): string =>
  `${input.nameFor(row.providerId)}: ${row.name}`;

export function incidentsRss(input: FeedInput): string {
  // A reader polls on `lastBuildDate`, so it is the newest thing the feed
  // knows rather than the moment it was rendered: a feed that changes its own
  // date every poll teaches the reader nothing.
  const newest = input.rows[0]?.updatedAt ?? input.generatedAt.toISOString();

  const items = input.rows.map((row) => {
    const link = linkFor(input.origin, row);
    const state =
      row.resolvedAt === null
        ? `Open since ${row.startedAt}`
        : `Resolved at ${row.resolvedAt}, open since ${row.startedAt}`;
    return [
      "<item>",
      `<title>${xml(titleFor(input, row))}</title>`,
      `<link>${xml(link)}</link>`,
      // Not a permalink: the id pair is stable across a renamed incident, and
      // the link carries a hash a reader cannot dereference on its own.
      `<guid isPermaLink="false">${xml(`${row.providerId}/${row.incidentId}`)}</guid>`,
      `<pubDate>${new Date(row.startedAt).toUTCString()}</pubDate>`,
      `<category>${xml(row.impact)}</category>`,
      `<description>${xml(`${state}. Impact: ${row.impact}. Status: ${row.status}.`)}</description>`,
      "</item>",
    ].join("\n");
  });

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "<channel>",
    `<title>${TITLE}</title>`,
    `<link>${xml(input.origin)}</link>`,
    `<description>${DESCRIPTION}</description>`,
    `<atom:link href="${xml(input.self)}" rel="self" type="application/rss+xml" />`,
    `<lastBuildDate>${new Date(newest).toUTCString()}</lastBuildDate>`,
    ...items,
    "</channel>",
    "</rss>",
    "",
  ].join("\n");
}

/** `20260901T100000Z` — the only form of an instant iCalendar accepts in UTC. */
const stamp = (iso: string): string => new Date(iso).toISOString().replaceAll(/[-:]|\.\d{3}/g, "");

/** Backslash, semicolon, comma and newline all end a property value early. */
const ics = (value: string): string =>
  value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll(/\r?\n/g, "\\n");

/**
 * RFC 5545 line folding: no line over 75 octets, continuations start with a
 * space. Counted in octets rather than characters, and never split inside one —
 * a provider writes incident names in whatever language it likes, and half a
 * multi-byte character is a corrupt file rather than a long line.
 */
function fold(line: string): string {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char);
    // 75 for the first line, one less after that: the leading space counts.
    if (bytes + size > (out.length === 0 ? 75 : 74)) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

export function incidentsIcs(input: FeedInput): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//IsItDown//incidents//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${ics(TITLE)}`,
  ];

  for (const row of input.rows) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ics(`${row.providerId}-${row.incidentId}@isitdown`)}`,
      `DTSTAMP:${stamp(input.generatedAt.toISOString())}`,
      `DTSTART:${stamp(row.startedAt)}`,
      // An open incident ends at the last thing we observed rather than at
      // "now": a calendar entry that grows every poll is a calendar entry that
      // never stops redrawing. TENTATIVE is what says it is not over yet.
      `DTEND:${stamp(row.resolvedAt ?? row.updatedAt)}`,
      `SUMMARY:${ics(titleFor(input, row))}`,
      `DESCRIPTION:${ics(`Impact: ${row.impact}. Status: ${row.status}.`)}`,
      `URL:${ics(linkFor(input.origin, row))}`,
      `STATUS:${row.resolvedAt === null ? "TENTATIVE" : "CONFIRMED"}`,
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
