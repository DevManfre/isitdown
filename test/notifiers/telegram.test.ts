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

test("a send reports the message_id Telegram assigned, so an update can edit it", async () => {
  const stub = stubFetch(() => jsonResponse({ ok: true, result: { message_id: 77 } }));
  try {
    assert.equal(await createTelegramNotifier(settings).send(degraded), "77");
  } finally {
    stub.restore();
  }
});

test("an answer without a message_id is still a delivered message", async () => {
  const stub = stubFetch(() => jsonResponse({ ok: true }));
  try {
    assert.equal(await createTelegramNotifier(settings).send(degraded), undefined);
  } finally {
    stub.restore();
  }
});

test("an update edits the message by id through editMessageText", async () => {
  const stub = stubFetch(() => jsonResponse({ ok: true, result: { message_id: 77 } }));
  try {
    await createTelegramNotifier(settings).update?.(degraded, "77");
  } finally {
    stub.restore();
  }
  const [request] = stub.requests;
  assert.ok(request?.url.endsWith("/editMessageText"), request?.url);
  const body = request?.body as { chat_id: string; message_id: number; text: string };
  assert.equal(body.message_id, 77);
  assert.equal(body.chat_id, settings.chatId);
  assert.ok(body.text.includes("GitHub"), body.text);
});

test("an edit Telegram refuses is reported rather than swallowed", async () => {
  // What Telegram answers for a message older than 48 hours.
  const stub = stubFetch(() => jsonResponse({ ok: false, description: "message can't be edited" }));
  try {
    await assert.rejects(createTelegramNotifier(settings).update?.(degraded, "77") ?? Promise.resolve(), {
      message: "telegram notification rejected: message can't be edited",
    });
  } finally {
    stub.restore();
  }
});

// Roadmap 3.1: Ack and Mute on the message itself.
const interactiveDegraded: NotificationPayload = { ...degraded, interactive: true };

test("an interactive message carries Ack and Mute 2h, addressed to its provider", async () => {
  const stub = stubFetch(() => jsonResponse({ ok: true, result: { message_id: 1 } }));
  try {
    await createTelegramNotifier(settings).send(interactiveDegraded);
  } finally {
    stub.restore();
  }
  const body = stub.requests[0]?.body as { reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } };
  assert.deepEqual(
    body.reply_markup?.inline_keyboard.flat().map((button) => button.callback_data),
    ["ack:github", "mute:github:120"],
  );
  assert.deepEqual(
    body.reply_markup?.inline_keyboard.flat().map((button) => button.text),
    ["✅ I'm on it", "🔕 Mute 2h"],
  );
});

test("the buttons speak the message's own language", async () => {
  const stub = stubFetch(() => jsonResponse({ ok: true, result: { message_id: 1 } }));
  try {
    await createTelegramNotifier(settings).send({ ...interactiveDegraded, locale: "it" });
  } finally {
    stub.restore();
  }
  const body = stub.requests[0]?.body as { reply_markup: { inline_keyboard: { text: string }[][] } };
  assert.deepEqual(
    body.reply_markup.inline_keyboard.flat().map((button) => button.text),
    ["✅ Preso in carico", "🔕 Silenzia 2h"],
  );
});

test("a message that is not interactive, or is a recovery, has no keyboard at all", async () => {
  const stub = stubFetch(() => jsonResponse({ ok: true, result: { message_id: 1 } }));
  try {
    await createTelegramNotifier(settings).send(degraded);
    await createTelegramNotifier(settings).send({ ...resolved, interactive: true });
  } finally {
    stub.restore();
  }
  for (const request of stub.requests) {
    assert.equal("reply_markup" in (request.body as object), false);
  }
});

test("a provider id too long for a button gets the message without one, not a broken button", async () => {
  const stub = stubFetch(() => jsonResponse({ ok: true, result: { message_id: 1 } }));
  const long = "p".repeat(80);
  try {
    await createTelegramNotifier(settings).send({
      ...interactiveDegraded,
      change: { ...interactiveDegraded.change, providerId: long },
    });
  } finally {
    stub.restore();
  }
  assert.equal("reply_markup" in (stub.requests[0]?.body as object), false);
});

test("editing an incident's message keeps its buttons", async () => {
  const stub = stubFetch(() => jsonResponse({ ok: true, result: { message_id: 1 } }));
  const updated: NotificationPayload = {
    ...interactiveDegraded,
    change: {
      kind: "incident_updated",
      providerId: "github",
      currentStatus: "major_outage",
      incident: { id: "i1", name: "API", impact: "major", status: "identified", updatedAt: "2026-08-19T14:40:00.000Z" },
      at: "2026-08-19T14:40:00.000Z",
    },
  };
  try {
    await createTelegramNotifier(settings).update!(updated, "55");
  } finally {
    stub.restore();
  }
  const body = stub.requests[0]?.body as { reply_markup?: { inline_keyboard: unknown[][] } };
  assert.equal(body.reply_markup?.inline_keyboard.flat().length, 2);
});

test("the message that resolves an incident edits the buttons away", async () => {
  const stub = stubFetch(() => jsonResponse({ ok: true, result: { message_id: 1 } }));
  try {
    await createTelegramNotifier(settings).update!({ ...resolved, interactive: true }, "55");
  } finally {
    stub.restore();
  }
  // An empty keyboard is how Telegram is told to remove one; omitting the field
  // would leave the old buttons under a message that says the trouble is over.
  const body = stub.requests[0]?.body as { reply_markup?: { inline_keyboard: unknown[][] } };
  assert.deepEqual(body.reply_markup, { inline_keyboard: [] });
});
