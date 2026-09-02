import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseFeed, parseFeedHistory, parseFeedStatus, rssAdapter } from "../../src/adapters/rss.adapter.ts";
import type { ServiceRef } from "../../src/core/adapter.interface.ts";
import { withServer } from "../helpers/localServer.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const service: ServiceRef = {
  id: "example",
  name: "Example",
  baseUrl: "https://status.example.com/history.rss",
};

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/rss/${name}.xml`, import.meta.url), "utf8");

/** Fixed so the fixtures' own dates keep meaning what they meant when written. */
const now = new Date("2026-09-01T12:00:00.000Z");

/** A feed built around one entry, for the cases a whole fixture would bury. */
const feedWith = (item: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Example</title>${item}</channel></rss>`;

const entry = (title: string, publishedAt = "Tue, 01 Sep 2026 11:00:00 +0000"): string =>
  `<item><guid>e1</guid><title>${title}</title><pubDate>${publishedAt}</pubDate></item>`;

runAdapterContract("rss", () => ({
  adapter: rssAdapter,
  service: (baseUrl) => ({ ...service, baseUrl: `${baseUrl}/history.rss` }),
  ok: { "/history.rss": fixture("incident") },
  // Nothing but the two tags an entry is identifiable and titled by.
  degraded: { "/history.rss": feedWith("<item><guid>e1</guid><title>Something happened</title></item>") },
}));

test("an open outage in an RSS feed reads as a major outage and is reported as an incident", () => {
  const status = parseFeedStatus(fixture("incident"), service, now);

  assert.equal(status.provider, "example");
  assert.equal(status.overallStatus, "major_outage");
  assert.deepEqual(
    status.activeIncidents.map((incident) => ({ id: incident.id, name: incident.name })),
    [{ id: "ghi789", name: "Major outage affecting the API & dashboard" }],
  );
});

test("a feed whose recent entries all announce a resolution reads operational", () => {
  const status = parseFeedStatus(fixture("resolved"), service, now);

  assert.equal(status.overallStatus, "operational");
  assert.deepEqual(status.activeIncidents, []);
});

test("a feed with no entries at all reads operational", () => {
  assert.equal(parseFeedStatus(fixture("empty"), service, now).overallStatus, "operational");
});

test("an entry older than the active window no longer counts, whatever it says", () => {
  const status = parseFeedStatus(fixture("operational"), service, now);

  assert.equal(status.overallStatus, "operational");
  assert.deepEqual(status.activeIncidents, []);
});

test("an Atom entry is read exactly like an RSS item", () => {
  const status = parseFeedStatus(fixture("atom-incident"), service, now);

  assert.equal(status.overallStatus, "degraded");
  assert.deepEqual(
    status.activeIncidents.map((incident) => incident.id),
    ["tag:status.example.com,2026:incident/777"],
  );
});

const severities: { title: string; expected: string }[] = [
  { title: "Major outage affecting everything", expected: "major_outage" },
  { title: "API is down", expected: "major_outage" },
  { title: "Checkout unavailable in eu-west", expected: "major_outage" },
  { title: "Partial outage on background jobs", expected: "partial_outage" },
  { title: "Degraded performance on the API", expected: "degraded" },
  { title: "Elevated latency on uploads", expected: "degraded" },
  { title: "Some jobs are running slow", expected: "degraded" },
  { title: "We are investigating reports of failures", expected: "degraded" },
];

for (const { title, expected } of severities) {
  test(`"${title}" maps to ${expected}`, () => {
    assert.equal(parseFeedStatus(feedWith(entry(title)), service, now).overallStatus, expected);
  });
}

test("the worst of several open entries decides the overall status", () => {
  const feed = feedWith(
    `${entry("Degraded performance on uploads")}<item><guid>e2</guid><title>Total outage on the API</title><pubDate>Tue, 01 Sep 2026 11:30:00 +0000</pubDate></item>`,
  );

  assert.equal(parseFeedStatus(feed, service, now).overallStatus, "major_outage");
  assert.equal(parseFeedStatus(feed, service, now).activeIncidents.length, 2);
});

const closings = ["Resolved: API outage", "API outage — completed", "Service restored after the outage"];

for (const title of closings) {
  test(`"${title}" is a closed entry, not an open incident`, () => {
    assert.equal(parseFeedStatus(feedWith(entry(title)), service, now).overallStatus, "operational");
  });
}

test("an entry with no date counts as open: a feed that omits one must not read as recovery", () => {
  const feed = feedWith("<item><guid>e1</guid><title>Major outage on the API</title></item>");

  assert.equal(parseFeedStatus(feed, service, now).overallStatus, "major_outage");
});

test("an entry with nothing to identify it by is dropped rather than given a made-up id", () => {
  const feed = feedWith("<item><title>Major outage on the API</title></item>");

  assert.deepEqual(parseFeedStatus(feed, service, now).activeIncidents, []);
});

test("an entry identified only by its link uses that as its id", () => {
  const feed = feedWith(
    "<item><link>https://status.example.com/incidents/42</link><title>Major outage</title></item>",
  );

  assert.deepEqual(
    parseFeedStatus(feed, service, now).activeIncidents.map((incident) => incident.id),
    ["https://status.example.com/incidents/42"],
  );
});

test("CDATA, entities and namespace prefixes are decoded rather than reported verbatim", () => {
  const entries = parseFeed(
    `<?xml version="1.0"?><rss:rss version="2.0"><rss:channel><rss:item><rss:guid>e1</rss:guid>` +
      `<rss:title><![CDATA[Outage on A & B]]></rss:title>` +
      `<rss:description>caf&#233; &amp; co</rss:description></rss:item></rss:channel></rss:rss>`,
  );

  assert.equal(entries[0]?.title, "Outage on A & B");
  assert.equal(entries[0]?.body, "café & co");
});

test("a body that is not a feed throws so the poller can retry", () => {
  assert.throws(() => parseFeedStatus("<html><body>login</body></html>", service, now));
  assert.throws(() => parseFeedStatus("not xml at all", service, now));
});

test("incident history places each entry on the timeline and closes the resolved ones", () => {
  const history = parseFeedHistory(fixture("incident"), service);

  assert.deepEqual(history.incidents, [
    {
      id: "ghi789",
      name: "Major outage affecting the API & dashboard",
      impact: "major_outage",
      status: "open",
      startedAt: "2026-09-01T08:30:00.000Z",
      resolvedAt: null,
      updatedAt: "2026-09-01T08:30:00.000Z",
    },
    {
      id: "abc123",
      name: "Resolved: Elevated error rates on the API",
      impact: "degraded",
      status: "resolved",
      startedAt: "2025-07-15T09:12:00.000Z",
      resolvedAt: "2025-07-15T09:12:00.000Z",
      updatedAt: "2025-07-15T09:12:00.000Z",
    },
  ]);
});

test("coverage never claims a full history: a feed is a window onto one", () => {
  const history = parseFeedHistory(fixture("incident"), service);

  assert.equal(history.coverageStart, "2025-07-15T09:12:00.000Z");
});

test("an entry with no date is left off the timeline it cannot be placed on", () => {
  const history = parseFeedHistory(feedWith("<item><guid>e1</guid><title>Outage</title></item>"), service);

  assert.deepEqual(history.incidents, []);
  assert.equal(history.coverageStart, null);
});

test("fetchStatus reads the base url itself as the feed and asks for a feed body", async () => {
  await withServer(
    (req, res) => {
      assert.equal(req.url, "/history.rss");
      assert.match(req.headers.accept ?? "", /xml/);
      res.writeHead(200, { "content-type": "application/rss+xml" });
      // Dated against the real clock: fetchStatus takes no `now`, so a fixture's
      // fixed date would age out of the active window and stop being an incident.
      res.end(feedWith(entry("Major outage affecting the API", new Date(Date.now() - 3_600_000).toUTCString())));
    },
    async (baseUrl) => {
      const status = await rssAdapter.fetchStatus(
        { ...service, baseUrl: `${baseUrl}/history.rss` },
        { timeoutMs: 2000 },
      );
      assert.equal(status.provider, "example");
      assert.equal(status.activeIncidents.length, 1);
    },
  );
});

test("the adapter offers no component listing: a feed has no components", () => {
  assert.equal(rssAdapter.listComponents, undefined);
});
