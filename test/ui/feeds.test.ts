import { test } from "node:test";
import assert from "node:assert/strict";
import { incidentsIcs, incidentsRss } from "../../src/ui/feeds.ts";
import type { IncidentRow } from "../../src/ui/historyStore.interface.ts";

const row = (over: Partial<IncidentRow> = {}): IncidentRow => ({
  providerId: "github",
  incidentId: "i1",
  name: "API errors",
  impact: "major",
  status: "investigating",
  startedAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:30:00.000Z",
  resolvedAt: null,
  ...over,
});

const feed = {
  rows: [row()],
  nameFor: (providerId: string) => (providerId === "github" ? "GitHub" : providerId),
  origin: "http://localhost:3000",
  generatedAt: new Date("2026-09-02T00:00:00.000Z"),
  self: "http://localhost:3000/feeds/incidents.xml",
};

test("the RSS channel names itself, its own url and the newest incident's date", () => {
  const xml = incidentsRss(feed);
  assert.match(xml, /^<\?xml version="1\.0" encoding="utf-8"\?>\n<rss version="2\.0"/);
  assert.match(xml, /<title>IsItDown incidents<\/title>/);
  assert.match(xml, /<atom:link href="http:\/\/localhost:3000\/feeds\/incidents\.xml" rel="self"/);
  assert.match(xml, /<lastBuildDate>Tue, 01 Sep 2026 10:30:00 GMT<\/lastBuildDate>/);
});

test("an item carries the provider, a stable guid and a deep link into the dashboard", () => {
  const xml = incidentsRss(feed);
  assert.match(xml, /<title>GitHub: API errors<\/title>/);
  assert.match(xml, /<guid isPermaLink="false">github\/i1<\/guid>/);
  assert.match(xml, /<link>http:\/\/localhost:3000\/#\/incidents\/github\/i1<\/link>/);
  assert.match(xml, /<pubDate>Tue, 01 Sep 2026 10:00:00 GMT<\/pubDate>/);
  assert.match(xml, /<category>major<\/category>/);
});

test("a resolved incident says so in its description; an open one says it is open", () => {
  assert.match(incidentsRss(feed), /Open since/);
  assert.match(
    incidentsRss({ ...feed, rows: [row({ resolvedAt: "2026-09-01T12:00:00.000Z" })] }),
    /Resolved/,
  );
});

test("upstream text is escaped rather than trusted", () => {
  const xml = incidentsRss({ ...feed, rows: [row({ name: 'Tom & "Jerry" <down>' })] });
  assert.match(xml, /Tom &amp; &quot;Jerry&quot; &lt;down&gt;/);
  assert.doesNotMatch(xml, /<down>/);
});

test("an empty history is still a valid feed with no items", () => {
  const xml = incidentsRss({ ...feed, rows: [] });
  assert.match(xml, /<\/channel>\n<\/rss>\n$/);
  assert.doesNotMatch(xml, /<item>/);
});

test("the calendar is CRLF-terminated and wraps every incident in one VEVENT", () => {
  const ics = incidentsIcs(feed);
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.equal(ics.split("BEGIN:VEVENT").length - 1, 1);
  assert.match(ics, /UID:github-i1@isitdown\r\n/);
  assert.match(ics, /DTSTART:20260901T100000Z\r\n/);
  assert.match(ics, /SUMMARY:GitHub: API errors\r\n/);
  assert.match(ics, /URL:http:\/\/localhost:3000\/#\/incidents\/github\/i1\r\n/);
});

test("an open incident ends at the last update and is TENTATIVE until it resolves", () => {
  const open = incidentsIcs(feed);
  assert.match(open, /DTEND:20260901T103000Z\r\n/);
  assert.match(open, /STATUS:TENTATIVE\r\n/);

  const resolved = incidentsIcs({ ...feed, rows: [row({ resolvedAt: "2026-09-01T12:00:00.000Z" })] });
  assert.match(resolved, /DTEND:20260901T120000Z\r\n/);
  assert.match(resolved, /STATUS:CONFIRMED\r\n/);
});

test("iCalendar text escaping covers the characters that would end a property early", () => {
  const ics = incidentsIcs({ ...feed, rows: [row({ name: "a, b; c\\d\ne" })] });
  assert.match(ics, /SUMMARY:GitHub: a\\, b\\; c\\\\d\\ne\r\n/);
});

test("a property longer than 75 octets is folded onto continuation lines", () => {
  const ics = incidentsIcs({ ...feed, rows: [row({ name: "x".repeat(200) })] });
  for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, line);
  assert.match(ics, /\r\n /);
});
