import { test } from "node:test";
import assert from "node:assert/strict";
import { createPagerdutyNotifier } from "../../src/notifiers/pagerduty.notifier.ts";
import { jsonResponse, stubFetch } from "../helpers/fetchStub.ts";
import type { NotificationPayload } from "../../src/core/types.ts";

const settings = { routingKey: "R0UT1NG-KEY" };

const incident = {
  id: "i1",
  name: "API requests failing",
  impact: "major",
  status: "investigating",
  updatedAt: "2026-08-19T14:32:07.000Z",
};

const opened: NotificationPayload = {
  change: {
    kind: "incident_opened",
    providerId: "github",
    currentStatus: "major_outage",
    incident,
    at: "2026-08-19T14:32:07.000Z",
  },
  service: { id: "github", name: "GitHub", statusUrl: "https://www.githubstatus.com" },
  locale: "en",
};

const resolved: NotificationPayload = {
  ...opened,
  change: {
    ...opened.change,
    kind: "incident_resolved",
    currentStatus: "operational",
    incident: { ...incident, status: "resolved" },
  },
};

type Event = {
  routing_key: string;
  event_action: string;
  dedup_key: string;
  payload: { summary: string; severity: string; source: string; timestamp: string };
  links: { href: string }[];
};

const ok = (): Response => jsonResponse({ status: "success", dedup_key: "x" }, 202);

test("an opened incident enqueues a trigger with the routing key and a link back", async () => {
  const stub = stubFetch(ok);
  try {
    await createPagerdutyNotifier(settings).send(opened);
  } finally {
    stub.restore();
  }

  const [request] = stub.requests;
  assert.equal(request?.url, "https://events.pagerduty.com/v2/enqueue");
  assert.equal(request?.method, "POST");
  const event = request?.body as Event;
  assert.equal(event.routing_key, "R0UT1NG-KEY");
  assert.equal(event.event_action, "trigger");
  assert.equal(event.payload.summary, "🔴 GitHub — MAJOR OUTAGE");
  assert.equal(event.payload.severity, "critical");
  assert.equal(event.payload.source, "github");
  assert.equal(event.payload.timestamp, "2026-08-19T14:32:07.000Z");
  assert.equal(event.links[0]?.href, "https://www.githubstatus.com");
});

test("the resolve names the very alert the trigger opened", async () => {
  const stub = stubFetch(ok);
  try {
    const notifier = createPagerdutyNotifier(settings);
    await notifier.send(opened);
    await notifier.send(resolved);
  } finally {
    stub.restore();
  }

  const [trigger, resolve] = stub.requests.map((request) => request.body as Event);
  assert.equal(trigger?.event_action, "trigger");
  assert.equal(resolve?.event_action, "resolve");
  assert.equal(resolve?.dedup_key, trigger?.dedup_key);
});

test("two open incidents on one provider are two alerts, each closing on its own", async () => {
  const stub = stubFetch(ok);
  try {
    const notifier = createPagerdutyNotifier(settings);
    await notifier.send(opened);
    await notifier.send({
      ...opened,
      change: { ...opened.change, incident: { ...incident, id: "i2" } },
    });
  } finally {
    stub.restore();
  }

  const [first, second] = stub.requests.map((request) => request.body as Event);
  assert.notEqual(first?.dedup_key, second?.dedup_key);
});

test("a status change back to operational resolves, a worsening one triggers", async () => {
  const stub = stubFetch(ok);
  try {
    const notifier = createPagerdutyNotifier(settings);
    await notifier.send({
      ...opened,
      change: { kind: "status_change", providerId: "github", currentStatus: "degraded", at: "2026-08-19T14:32:07.000Z" },
    });
    await notifier.send({
      ...opened,
      change: { kind: "status_change", providerId: "github", currentStatus: "operational", at: "2026-08-19T15:02:07.000Z" },
    });
  } finally {
    stub.restore();
  }

  const [worse, better] = stub.requests.map((request) => request.body as Event);
  assert.equal(worse?.event_action, "trigger");
  assert.equal(better?.event_action, "resolve");
  assert.equal(worse?.dedup_key, better?.dedup_key);
});

test("a digest never resolves — its worst member standing in for the rest is not a recovery", async () => {
  const stub = stubFetch(ok);
  try {
    await createPagerdutyNotifier(settings).send({
      ...resolved,
      digest: { items: [resolved, opened], windowMinutes: 5 },
    });
  } finally {
    stub.restore();
  }
  assert.equal((stub.requests[0]?.body as Event).event_action, "trigger");
});

test("an account in the EU service region enqueues to the EU endpoint", async () => {
  const stub = stubFetch(ok);
  try {
    await createPagerdutyNotifier({ ...settings, region: "eu" }).send(opened);
  } finally {
    stub.restore();
  }
  assert.equal(stub.requests[0]?.url, "https://events.eu.pagerduty.com/v2/enqueue");
});

test("a rejected send reports PagerDuty's own errors, never the routing key", async () => {
  const stub = stubFetch(
    () => jsonResponse({ message: "Event object is invalid", errors: ["'payload' is missing"] }, 400),
  );
  try {
    await createPagerdutyNotifier(settings).send(opened);
    assert.fail("expected the send to reject");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.ok(message.includes("400"), message);
    assert.ok(message.includes("'payload' is missing"), message);
    assert.ok(!message.includes("R0UT1NG-KEY"), message);
  } finally {
    stub.restore();
  }
});

test("the notifier refuses a missing routing key or an unknown region", () => {
  assert.throws(() => createPagerdutyNotifier({ routingKey: "" }), /routingKey/);
  assert.throws(() => createPagerdutyNotifier({ ...settings, region: "apac" }), /region/);
});

test("the notifier reports its channel id", () => {
  assert.equal(createPagerdutyNotifier(settings).id, "pagerduty");
});
