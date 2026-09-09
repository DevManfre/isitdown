import { test } from "node:test";
import assert from "node:assert/strict";
import { createDiscordNotifier } from "../../src/notifiers/discord.notifier.ts";
import { stubFetch, jsonResponse } from "../helpers/fetchStub.ts";
import type { NotificationPayload } from "../../src/core/types.ts";

const settings = { webhookUrl: "https://discord.com/api/webhooks/1/abc" };

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

type DiscordBody = {
  embeds: { title: string; description: string; color: number; url: string }[];
};

test("an opened incident posts one embed titled with the severity", async () => {
  const stub = stubFetch(() => new Response(null, { status: 204 }));
  try {
    await createDiscordNotifier(settings).send(opened);
  } finally {
    stub.restore();
  }
  const [request] = stub.requests;
  // `?wait=true` so Discord answers with the message it created: its id is what
  // an edit needs later (roadmap 3.19).
  assert.equal(request?.url, `${settings.webhookUrl}?wait=true`);
  assert.equal(request?.method, "POST");
  assert.equal(request?.headers["content-type"], "application/json");
  const body = request?.body as DiscordBody;
  assert.equal(body.embeds.length, 1);
  const [embed] = body.embeds;
  assert.equal(embed?.title, "🔴 GitHub — MAJOR OUTAGE");
  assert.equal(embed?.url, opened.service.statusUrl);
  assert.ok(embed?.description.includes("API requests failing"), embed?.description);
  assert.ok(embed?.description.includes("Investigating"), embed?.description);
});

test("the embed carries the severity colour and links out only through its title", async () => {
  const stub = stubFetch(() => new Response(null, { status: 204 }));
  try {
    await createDiscordNotifier(settings).send(opened);
  } finally {
    stub.restore();
  }
  const [embed] = (stub.requests[0]?.body as DiscordBody).embeds;
  assert.equal(embed?.color, 0xb91c1c);
  // The status page is the hyperlinked title; repeating the bare URL in the
  // description would render it a second time under the same embed.
  assert.ok(!embed?.description.includes("githubstatus.com"), embed?.description);
});

test("a resolved transition is headed by the word resolved", async () => {
  const stub = stubFetch(() => new Response(null, { status: 204 }));
  try {
    await createDiscordNotifier(settings).send({
      ...opened,
      change: { ...opened.change, kind: "incident_resolved", currentStatus: "operational" },
    });
  } finally {
    stub.restore();
  }
  const [embed] = (stub.requests[0]?.body as DiscordBody).embeds;
  assert.equal(embed?.title, "🟢 GitHub — RESOLVED");
  assert.equal(embed?.color, 0x15803d);
});

test("a non-2xx response rejects with the status code", async () => {
  const stub = stubFetch(() => jsonResponse({ message: "Unknown Webhook" }, 404));
  try {
    await assert.rejects(createDiscordNotifier(settings).send(opened), /404/);
  } finally {
    stub.restore();
  }
});

test("a rejection reports Discord's own message without the webhook url", async () => {
  const stub = stubFetch(() => jsonResponse({ message: "Unknown Webhook" }, 404));
  try {
    await createDiscordNotifier(settings).send(opened);
    assert.fail("expected the send to reject");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.ok(message.includes("Unknown Webhook"), message);
    // The webhook URL is the credential: it must never reach a log or the
    // dashboard's notification feed.
    assert.ok(!message.includes("abc"), message);
  } finally {
    stub.restore();
  }
});

test("the notifier refuses a missing or non-http webhook url", () => {
  assert.throws(() => createDiscordNotifier({ webhookUrl: "" }), /webhookUrl/);
  assert.throws(() => createDiscordNotifier({ webhookUrl: "ftp://discord.com/x" }), /webhookUrl/);
});

test("the notifier reports its channel id", () => {
  assert.equal(createDiscordNotifier(settings).id, "discord");
});

test("a send reports the message id Discord assigned, so an update can edit it", async () => {
  const stub = stubFetch(() => jsonResponse({ id: "42" }));
  try {
    const ref = await createDiscordNotifier(settings).send(opened);
    assert.equal(ref, "42");
  } finally {
    stub.restore();
  }
});

test("an answer without an id is still a delivered message", async () => {
  const stub = stubFetch(() => new Response(null, { status: 204 }));
  try {
    assert.equal(await createDiscordNotifier(settings).send(opened), undefined);
  } finally {
    stub.restore();
  }
});

test("an update patches the message by id, with the same embed a send posts", async () => {
  const stub = stubFetch(() => jsonResponse({ id: "42" }));
  try {
    await createDiscordNotifier(settings).update?.(opened, "42");
  } finally {
    stub.restore();
  }
  const [request] = stub.requests;
  assert.equal(request?.url, `${settings.webhookUrl}/messages/42`);
  assert.equal(request?.method, "PATCH");
  const [embed] = (request?.body as DiscordBody).embeds;
  assert.equal(embed?.title, "🔴 GitHub — MAJOR OUTAGE");
});

test("an update Discord refuses is reported, so the dispatcher can send a new message", async () => {
  const stub = stubFetch(() => jsonResponse({ message: "Unknown Message" }, 404));
  try {
    await assert.rejects(createDiscordNotifier(settings).update?.(opened, "42") ?? Promise.resolve(), {
      message: "discord notification edit failed: HTTP 404 (Unknown Message)",
    });
  } finally {
    stub.restore();
  }
});
