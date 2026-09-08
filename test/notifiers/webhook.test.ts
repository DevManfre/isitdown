import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWebhookNotifier,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifySignature,
} from "../../src/notifiers/webhook.notifier.ts";
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

test("with a secret configured, the request carries a signature over the timestamp and the exact body", async () => {
  const stub = stubFetch(() => jsonResponse({ received: true }));
  try {
    await createWebhookNotifier({ ...settings, secret: "s3cret" }).send(payload);
  } finally {
    stub.restore();
  }

  const [request] = stub.requests;
  const signature = request?.headers[SIGNATURE_HEADER] ?? "";
  const timestamp = request?.headers[TIMESTAMP_HEADER] ?? "";
  const body = request?.rawBody ?? "";

  assert.ok(signature.startsWith("sha256="), `signature header was ${signature}`);
  assert.ok(!Number.isNaN(Date.parse(timestamp)), `timestamp header was ${timestamp}`);
  assert.ok(
    verifySignature("s3cret", timestamp, body, signature),
    "the header must verify against the bytes the receiver was actually sent",
  );
  // The wrong secret must not verify, or the header proves nothing.
  assert.equal(verifySignature("other", timestamp, body, signature), false);
  // Nor the right secret over a different timestamp: that is what makes a
  // replayed request rejectable by age.
  assert.equal(verifySignature("s3cret", "2020-01-01T00:00:00.000Z", body, signature), false);
  // Nor a body someone edited in flight.
  assert.equal(verifySignature("s3cret", timestamp, `${body} `, signature), false);
});

test("without a secret the request is unsigned, so an existing receiver is unaffected", async () => {
  const stub = stubFetch(() => jsonResponse({ received: true }));
  try {
    await createWebhookNotifier(settings).send(payload);
  } finally {
    stub.restore();
  }

  assert.equal(stub.requests[0]?.headers[SIGNATURE_HEADER], undefined);
  assert.equal(stub.requests[0]?.headers[TIMESTAMP_HEADER], undefined);
});

test("an empty secret is not a secret, so it cannot produce a signature nothing can check", async () => {
  const stub = stubFetch(() => jsonResponse({ received: true }));
  try {
    await createWebhookNotifier({ ...settings, secret: "" }).send(payload);
  } finally {
    stub.restore();
  }

  assert.equal(stub.requests[0]?.headers[SIGNATURE_HEADER], undefined);
});
