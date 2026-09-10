import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseSlackHistory, parseSlackStatus, slackAdapter } from "../../src/adapters/slack.adapter.ts";
import type { ServiceRef } from "../../src/core/adapter.interface.ts";
import { withServer } from "../helpers/localServer.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const service: ServiceRef = {
  id: "slack",
  name: "Slack",
  baseUrl: "https://slack-status.com",
};

/**
 * Recorded from the live API (`npm run record-fixture`); `history.json` is the
 * real answer truncated to its first eight entries, `operational.json` the same
 * recorded shape with the incident list empty, which is what `/current`
 * answers while Slack is fine.
 */
const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/slack/${name}.json`, import.meta.url), "utf8");

/** A `/current` body built around one incident, for cases a fixture would bury. */
const currentWith = (...incidents: Record<string, unknown>[]): string =>
  JSON.stringify({ status: incidents.length === 0 ? "ok" : "active", active_incidents: incidents });

const incident = (title: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 1,
  title,
  type: "incident",
  status: "active",
  date_created: "2026-09-01T08:00:00-07:00",
  date_updated: "2026-09-01T09:00:00-07:00",
  ...extra,
});

runAdapterContract("slack", () => ({
  adapter: slackAdapter,
  service: (baseUrl) => ({ ...service, baseUrl }),
  ok: {
    "/api/v2.0.0/current": fixture("incident"),
    "/api/v2.0.0/history": fixture("history"),
  },
  // Nothing but the id an incident is identifiable by.
  degraded: {
    "/api/v2.0.0/current": JSON.stringify({ active_incidents: [{ id: 1 }] }),
    "/api/v2.0.0/history": JSON.stringify([{ id: 1 }]),
  },
}));

test("a body without an incident list at all is refused rather than read as calm", () => {
  assert.throws(() => parseSlackStatus("{}", service), /not a current-status payload/);
});

test("an open Slack incident is reported, with its severity read from the title", () => {
  const status = parseSlackStatus(fixture("incident"), service);

  assert.equal(status.provider, "slack");
  assert.equal(status.overallStatus, "degraded");
  assert.deepEqual(status.activeIncidents, [
    {
      id: "1576",
      name: "Trouble Accessing Historical Messages With Custom Data Retention Policies Enabled",
      impact: "degraded",
      status: "active",
      // The provider answers in -07:00; everything downstream is UTC.
      updatedAt: "2026-09-01T22:51:21.000Z",
    },
  ]);
});

test("no active incident reads operational", () => {
  const status = parseSlackStatus(fixture("operational"), service);

  assert.equal(status.overallStatus, "operational");
  assert.deepEqual(status.activeIncidents, []);
});

const severities: { title: string; expected: string }[] = [
  { title: "Slack is down for all workspaces", expected: "major_outage" },
  { title: "Connectivity unavailable in some regions", expected: "major_outage" },
  { title: "Partial outage affecting Huddles", expected: "partial_outage" },
  { title: "Feature Degradation Affecting the Receipt of Emails", expected: "degraded" },
  { title: "Trouble Using Search Bar For Some Admins", expected: "degraded" },
];

for (const { title, expected } of severities) {
  test(`"${title}" reads as ${expected}`, () => {
    assert.equal(parseSlackStatus(currentWith(incident(title)), service).overallStatus, expected);
  });
}

test("the worst open incident decides the provider's reading", () => {
  const body = currentWith(
    incident("Trouble loading canvases", { id: 1 }),
    incident("Messaging outage", { id: 2 }),
  );

  assert.equal(parseSlackStatus(body, service).overallStatus, "major_outage");
});

test("an active incident outweighs a top-level status that still says ok", () => {
  const body = JSON.stringify({ status: "ok", active_incidents: [incident("Messaging outage")] });

  assert.equal(parseSlackStatus(body, service).overallStatus, "major_outage");
});

test("a notice is surfaced but does not move the provider's status on its own", () => {
  const status = parseSlackStatus(currentWith(incident("Upcoming API deprecation", { type: "notice" })), service);

  assert.equal(status.overallStatus, "operational");
  assert.deepEqual(
    status.activeIncidents.map((entry) => entry.id),
    ["1"],
  );
});

test("an entry with no id is dropped: nothing downstream could track it", () => {
  const body = JSON.stringify({ status: "active", active_incidents: [{ title: "Messaging outage" }] });
  const status = parseSlackStatus(body, service);

  assert.deepEqual(status.activeIncidents, []);
  assert.equal(status.overallStatus, "operational");
});

test("a body that is not this provider's payload at all throws", () => {
  assert.throws(() => parseSlackStatus(JSON.stringify([{ id: 1 }]), service), /slack/);
});

test("a resolved incident carries the closure timestamp the API gives", () => {
  const { incidents } = parseSlackHistory(fixture("history"), service);
  const resolved = incidents.find((entry) => entry.id === "1575");

  assert.deepEqual(resolved, {
    id: "1575",
    name: "Trouble Using Search Bar For Some Admins",
    impact: "degraded",
    status: "resolved",
    startedAt: "2026-08-06T22:22:35.000Z",
    resolvedAt: "2026-08-07T01:08:09.000Z",
    updatedAt: "2026-08-07T01:08:09.000Z",
  });
});

test("an incident still open in the history has no closure timestamp", () => {
  const { incidents } = parseSlackHistory(fixture("history"), service);
  const open = incidents.find((entry) => entry.id === "1576");

  assert.equal(open?.status, "active");
  assert.equal(open?.resolvedAt, null);
});

test("coverage never claims a full history: the endpoint is a window onto one", () => {
  const { incidents, coverageStart } = parseSlackHistory(fixture("history"), service);
  const oldest = incidents.map((entry) => entry.startedAt).sort()[0];

  assert.equal(coverageStart, oldest);
});

test("an undated history entry is left off the timeline it cannot be placed on", () => {
  const body = JSON.stringify([{ id: 9, title: "Messaging outage", status: "resolved" }]);

  assert.deepEqual(parseSlackHistory(body, service).incidents, []);
});

test("fetchStatus reads the documented endpoint and asks for JSON", async () => {
  const seen: { url: string | undefined; accept: string | undefined }[] = [];

  await withServer(
    (req, res) => {
      seen.push({ url: req.url, accept: req.headers.accept });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(fixture("operational"));
    },
    async (baseUrl) => {
      await slackAdapter.fetchStatus({ ...service, baseUrl }, { timeoutMs: 2000 });
    },
  );

  assert.deepEqual(
    seen.map((request) => request.url),
    ["/api/v2.0.0/current"],
  );
  assert.match(seen[0]!.accept ?? "", /application\/json/);
});

test("the adapter offers no component listing: Slack publishes no component statuses", () => {
  assert.equal(slackAdapter.listComponents, undefined);
});
