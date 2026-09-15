import { test } from "node:test";
import assert from "node:assert/strict";
import { createPushoverNotifier } from "../../src/notifiers/pushover.notifier.ts";
import { stubFetch } from "../helpers/fetchStub.ts";
import type { NotificationPayload } from "../../src/core/types.ts";

const settings = { token: "AppTokenSecret", userKey: "UserKeySecret" };

const opened: NotificationPayload = {
  change: {
    kind: "incident_opened",
    providerId: "github",
    currentStatus: "major_outage",
    incident: {
      id: "i1",
      name: "API requests failing",
      impact: "major",
      status: "investigating",
      updatedAt: "2026-08-19T14:32:07.000Z",
    },
    at: "2026-08-19T14:32:07.000Z",
  },
  service: { id: "github", name: "GitHub", statusUrl: "https://www.githubstatus.com" },
  locale: "en",
};

const okResponse = (): Response => new Response(JSON.stringify({ status: 1 }), { status: 200 });

/** The body is form-encoded, so the fetch stub's JSON parse is no help here. */
const form = (raw: string | undefined): URLSearchParams => new URLSearchParams(raw ?? "");

test("an opened incident posts a titled message to the messages endpoint", async () => {
  const stub = stubFetch(okResponse);
  try {
    await createPushoverNotifier(settings).send(opened);
  } finally {
    stub.restore();
  }

  const request = stub.requests[0];
  assert.equal(request?.url, "https://api.pushover.net/1/messages.json");
  assert.equal(request?.method, "POST");
  assert.equal(request?.headers["content-type"], "application/x-www-form-urlencoded");

  const body = form(request?.rawBody);
  assert.ok(body.get("title")?.includes("MAJOR OUTAGE"), body.get("title") ?? "");
  assert.ok(body.get("message")?.includes("API requests failing"), body.get("message") ?? "");
  // The status page is the notification's tap target, not a line in the text.
  assert.ok(!body.get("message")?.includes("githubstatus.com"), body.get("message") ?? "");
  assert.equal(body.get("url"), opened.service.statusUrl);
  assert.equal(body.get("url_title"), "GitHub");
});

test("both credentials travel in the body, never in the URL", async () => {
  const stub = stubFetch(okResponse);
  try {
    await createPushoverNotifier(settings).send(opened);
  } finally {
    stub.restore();
  }

  const body = form(stub.requests[0]?.rawBody);
  assert.equal(body.get("token"), "AppTokenSecret");
  assert.equal(body.get("user"), "UserKeySecret");
  assert.ok(!stub.requests[0]?.url.includes("AppTokenSecret"), stub.requests[0]?.url);
  assert.ok(!stub.requests[0]?.url.includes("UserKeySecret"), stub.requests[0]?.url);
});

test("severity decides priority, so only real trouble bypasses quiet hours", async () => {
  const stub = stubFetch(okResponse);
  try {
    const notifier = createPushoverNotifier(settings);
    await notifier.send(opened);
    await notifier.send({ ...opened, change: { ...opened.change, currentStatus: "degraded" } });
    await notifier.send({
      ...opened,
      change: { ...opened.change, kind: "monitoring_degraded", currentStatus: "unknown" },
    });
  } finally {
    stub.restore();
  }

  assert.deepEqual(
    stub.requests.map((request) => form(request.rawBody).get("priority")),
    ["1", "0", "-1"],
  );
});

test("a device is sent only when one is configured", async () => {
  const stub = stubFetch(okResponse);
  try {
    await createPushoverNotifier(settings).send(opened);
    await createPushoverNotifier({ ...settings, device: "phone" }).send(opened);
  } finally {
    stub.restore();
  }

  assert.equal(form(stub.requests[0]?.rawBody).has("device"), false);
  assert.equal(form(stub.requests[1]?.rawBody).get("device"), "phone");
});

test("a non-2xx response rejects with Pushover's own reason, never a credential", async () => {
  const stub = stubFetch(
    () => new Response(JSON.stringify({ status: 0, errors: ["user key is invalid"] }), { status: 400 }),
  );
  try {
    await createPushoverNotifier(settings).send(opened);
    assert.fail("expected send to reject");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.ok(message.includes("400"), message);
    assert.ok(message.includes("user key is invalid"), message);
    assert.ok(!message.includes("AppTokenSecret"), message);
    assert.ok(!message.includes("UserKeySecret"), message);
  } finally {
    stub.restore();
  }
});

test("the notifier refuses a missing token or user key", () => {
  assert.throws(() => createPushoverNotifier({ token: "", userKey: "u" }), /token/);
  assert.throws(() => createPushoverNotifier({ token: "t", userKey: "" }), /userKey/);
});

test("the notifier reports its channel id", () => {
  assert.equal(createPushoverNotifier(settings).id, "pushover");
});
