import { test } from "node:test";
import assert from "node:assert/strict";
import { createNtfyNotifier } from "../../src/notifiers/ntfy.notifier.ts";
import { stubFetch } from "../helpers/fetchStub.ts";
import type { NotificationPayload } from "../../src/core/types.ts";

const settings = { topicUrl: "https://ntfy.sh/isitdown-alerts", token: "tk_secret" };

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

const okResponse = (): Response => new Response("{}", { status: 200 });

test("an opened incident posts the detail as the body, with the heading as the title", async () => {
  const stub = stubFetch(okResponse);
  try {
    await createNtfyNotifier(settings).send(opened);
  } finally {
    stub.restore();
  }

  const [request] = stub.requests;
  assert.equal(request?.url, settings.topicUrl);
  assert.equal(request?.method, "POST");
  assert.equal(request?.headers["title"], "=?UTF-8?B?8J+UtCBHaXRIdWIg4oCUIE1BSk9SIE9VVEFHRQ==?=");
  assert.ok(request?.rawBody?.includes("API requests failing"), request?.rawBody);
  // The link is the notification's own tap target, so the body does not repeat it.
  assert.ok(!request?.rawBody?.includes("githubstatus.com"), request?.rawBody);
  assert.equal(request?.headers["click"], opened.service.statusUrl);
});

test("severity decides the priority, so only the worst reading is allowed to ring", async () => {
  const stub = stubFetch(okResponse);
  try {
    const notifier = createNtfyNotifier(settings);
    await notifier.send(opened);
    await notifier.send({ ...opened, change: { ...opened.change, currentStatus: "degraded" } });
    await notifier.send({
      ...opened,
      change: { ...opened.change, kind: "incident_resolved", currentStatus: "operational" },
    });
  } finally {
    stub.restore();
  }

  assert.deepEqual(
    stub.requests.map((request) => request.headers["priority"]),
    ["5", "3", "2"],
  );
});

test("a token is sent as a bearer credential, and a public topic needs none", async () => {
  const stub = stubFetch(okResponse);
  try {
    await createNtfyNotifier(settings).send(opened);
    await createNtfyNotifier({ topicUrl: settings.topicUrl }).send(opened);
  } finally {
    stub.restore();
  }

  assert.equal(stub.requests[0]?.headers["authorization"], "Bearer tk_secret");
  assert.equal(stub.requests[1]?.headers["authorization"], undefined);
});

test("a non-2xx response rejects with the status and ntfy's own reason, never the token", async () => {
  const stub = stubFetch(
    () => new Response(JSON.stringify({ error: "topic is protected" }), { status: 403 }),
  );
  try {
    await createNtfyNotifier(settings).send(opened);
    assert.fail("expected the send to reject");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.ok(message.includes("403"), message);
    assert.ok(message.includes("topic is protected"), message);
    assert.ok(!message.includes("tk_secret"), message);
  } finally {
    stub.restore();
  }
});

test("the notifier refuses a missing or non-http topic url", () => {
  assert.throws(() => createNtfyNotifier({ topicUrl: "" }), /topicUrl/);
  assert.throws(() => createNtfyNotifier({ topicUrl: "ntfy://isitdown" }), /topicUrl/);
});

test("a self-hosted server is the same setting as ntfy.sh", async () => {
  const stub = stubFetch(okResponse);
  try {
    await createNtfyNotifier({ topicUrl: "https://push.example.com/isitdown" }).send(opened);
  } finally {
    stub.restore();
  }
  assert.equal(stub.requests[0]?.url, "https://push.example.com/isitdown");
});

test("the notifier reports its channel id", () => {
  assert.equal(createNtfyNotifier(settings).id, "ntfy");
});
