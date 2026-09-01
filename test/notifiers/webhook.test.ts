import { test } from "node:test";
import assert from "node:assert/strict";
import { createWebhookNotifier } from "../../src/notifiers/webhook.notifier.ts";
import { stubFetch, jsonResponse } from "../helpers/fetchStub.ts";
import type { NotificationPayload } from "../../src/core/types.ts";

const settings = { url: "https://hooks.example/isitdown" };

const payload: NotificationPayload = {
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

test("an opened incident posts the structured change plus the rendered message", async () => {
  const stub = stubFetch(() => jsonResponse({ received: true }));
  try {
    await createWebhookNotifier(settings).send(payload);
  } finally {
    stub.restore();
  }
  const [request] = stub.requests;
  assert.equal(request?.url, settings.url);
  assert.equal(request?.method, "POST");
  assert.equal(request?.headers["content-type"], "application/json");
  const body = request?.body as {
    change: { kind: string; providerId: string };
    service: { id: string };
    message: string;
  };
  assert.equal(body.change.kind, "incident_opened");
  assert.equal(body.change.providerId, "github");
  assert.equal(body.service.id, "github");
  assert.ok(body.message.includes("API requests failing"));
});

test("a resolved transition posts the resolution", async () => {
  const stub = stubFetch(() => jsonResponse({ received: true }));
  try {
    await createWebhookNotifier(settings).send({
      ...payload,
      change: { ...payload.change, kind: "incident_resolved", currentStatus: "operational" },
    });
  } finally {
    stub.restore();
  }
  const body = stub.requests[0]?.body as { change: { kind: string }; message: string };
  assert.equal(body.change.kind, "incident_resolved");
  assert.ok(body.message.includes("RESOLVED"));
});

test("a non-2xx response rejects with the status code", async () => {
  const stub = stubFetch(() => new Response("nope", { status: 502 }));
  try {
    await assert.rejects(createWebhookNotifier(settings).send(payload), /502/);
  } finally {
    stub.restore();
  }
});

test("the notifier refuses a missing or non-http url", () => {
  assert.throws(() => createWebhookNotifier({ url: "" }), /url/);
  assert.throws(() => createWebhookNotifier({ url: "ftp://hooks.example" }), /url/);
});

test("the notifier reports its channel id", () => {
  assert.equal(createWebhookNotifier(settings).id, "webhook");
});
