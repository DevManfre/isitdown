import { test } from "node:test";
import assert from "node:assert/strict";
import { createTelegramNotifier } from "../../src/notifiers/telegram.notifier.ts";
import { stubFetch, jsonResponse } from "../helpers/fetchStub.ts";
import type { NotificationPayload } from "../../src/core/types.ts";

const TOKEN = "123456:AAtotally-not-a-real-token";
const settings = { botToken: TOKEN, chatId: "-1001234567890" };

const degraded: NotificationPayload = {
  change: {
    kind: "status_change",
    providerId: "github",
    previousStatus: "operational",
    currentStatus: "degraded",
    at: "2026-08-19T14:32:07.000Z",
  },
  service: { id: "github", name: "GitHub", statusUrl: "https://www.githubstatus.com" },
  locale: "en",
};

const resolved: NotificationPayload = {
  ...degraded,
  change: {
    kind: "incident_resolved",
    providerId: "github",
    previousStatus: "major_outage",
    currentStatus: "operational",
    incident: {
      id: "i1",
      name: "API requests failing",
      impact: "major",
      status: "resolved",
      updatedAt: "2026-08-19T15:10:00.000Z",
    },
    at: "2026-08-19T15:10:00.000Z",
  },
};

test("a degraded transition posts sendMessage with the chat id and rendered text", async () => {
  const stub = stubFetch(() => jsonResponse({ ok: true, result: { message_id: 1 } }));
  try {
    await createTelegramNotifier(settings).send(degraded);
  } finally {
    stub.restore();
  }
  assert.equal(stub.requests.length, 1);
  const [request] = stub.requests;
  assert.equal(request?.url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.equal(request?.method, "POST");
  assert.equal(request?.headers["content-type"], "application/json");
  const body = request?.body as { chat_id: string; text: string };
  assert.equal(body.chat_id, settings.chatId);
  assert.ok(body.text.includes("GitHub"));
  assert.ok(body.text.includes("DEGRADED"));
});

test("a resolved transition posts the resolution text", async () => {
  const stub = stubFetch(() => jsonResponse({ ok: true, result: { message_id: 2 } }));
  try {
    await createTelegramNotifier(settings).send(resolved);
  } finally {
    stub.restore();
  }
  const body = stub.requests[0]?.body as { text: string };
  assert.ok(body.text.includes("RESOLVED"), body.text);
  assert.ok(body.text.includes("API requests failing"));
});

test("a non-2xx response rejects and the message never contains the bot token", async () => {
  const stub = stubFetch(() => jsonResponse({ ok: false, description: "chat not found" }, 400));
  try {
    await assert.rejects(createTelegramNotifier(settings).send(degraded), (error: unknown) => {
      const message = (error as Error).message;
      assert.ok(message.includes("400"), message);
      assert.ok(!message.includes(TOKEN), "the bot token must never appear in an error message");
      return true;
    });
  } finally {
    stub.restore();
  }
});

test("a 200 response carrying ok:false is still a failure", async () => {
  const stub = stubFetch(() => jsonResponse({ ok: false, description: "bot was blocked by the user" }));
  try {
    await assert.rejects(createTelegramNotifier(settings).send(degraded), /blocked/);
  } finally {
    stub.restore();
  }
});

test("the notifier refuses to be built without its required settings", () => {
  assert.throws(() => createTelegramNotifier({ botToken: "", chatId: "1" }), /botToken/);
  assert.throws(() => createTelegramNotifier({ botToken: TOKEN, chatId: "" }), /chatId/);
});

test("the notifier reports its channel id", () => {
  assert.equal(createTelegramNotifier(settings).id, "telegram");
});
