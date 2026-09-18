import { test } from "node:test";
import assert from "node:assert/strict";
import { createTelegramBot } from "../../src/notifiers/telegram.bot.ts";
import { createLogger } from "../../src/core/logger.ts";
import { stubFetch, jsonResponse, type CapturedRequest } from "../helpers/fetchStub.ts";

const TOKEN = "123456:AAtotally-not-a-real-token";
const ALLOWED = "-1001234567890";

const silentLogger = createLogger("error", () => {});

/** One `getUpdates` answer, then an empty one so a second poll finds nothing. */
function respondWith(messages: { id: number; chat: string; text: string }[]) {
  let served = false;
  return (request: CapturedRequest): Response => {
    if (request.url.endsWith("/getUpdates")) {
      const result = served
        ? []
        : messages.map((message) => ({
            update_id: message.id,
            message: { text: message.text, chat: { id: message.chat }, from: { id: 42, username: "op" } },
          }));
      served = true;
      return jsonResponse({ ok: true, result });
    }
    return jsonResponse({ ok: true, result: { message_id: 1 } });
  };
}

const sends = (requests: CapturedRequest[]) => requests.filter((request) => request.url.endsWith("/sendMessage"));

test("a command from an allowed chat is answered", async () => {
  const fetch = stubFetch(respondWith([{ id: 10, chat: ALLOWED, text: "/status" }]));
  try {
    const bot = createTelegramBot({
      botToken: TOKEN,
      allowedChatIds: [ALLOWED],
      logger: silentLogger,
      onCommand: async () => "everything is fine",
    });
    assert.equal(await bot.pollOnce(), 1);
    assert.deepEqual(sends(fetch.requests).map((request) => request.body), [
      { chat_id: ALLOWED, text: "everything is fine", disable_web_page_preview: true },
    ]);
  } finally {
    fetch.restore();
  }
});

test("a command from a chat that is not on the allowlist is ignored, not refused", async () => {
  // Silence rather than "you may not do that": a refusal confirms the bot is
  // here and listening to whoever is probing it.
  const fetch = stubFetch(respondWith([{ id: 11, chat: "-100999", text: "/mute github 8h" }]));
  let asked = false;
  try {
    const bot = createTelegramBot({
      botToken: TOKEN,
      allowedChatIds: [ALLOWED],
      logger: silentLogger,
      onCommand: async () => {
        asked = true;
        return "muted";
      },
    });
    assert.equal(await bot.pollOnce(), 0);
    assert.equal(asked, false, "an unauthorised chat must never reach the command handler");
    assert.deepEqual(sends(fetch.requests), []);
  } finally {
    fetch.restore();
  }
});

test("a handler that answers null sends nothing, so ordinary chat stays quiet", async () => {
  const fetch = stubFetch(respondWith([{ id: 12, chat: ALLOWED, text: "morning" }]));
  try {
    const bot = createTelegramBot({
      botToken: TOKEN,
      allowedChatIds: [ALLOWED],
      logger: silentLogger,
      onCommand: async () => null,
    });
    assert.equal(await bot.pollOnce(), 0);
    assert.deepEqual(sends(fetch.requests), []);
  } finally {
    fetch.restore();
  }
});

test("the offset advances past a handled update, so it is never redelivered", async () => {
  const fetch = stubFetch(respondWith([{ id: 77, chat: ALLOWED, text: "/status" }]));
  try {
    const bot = createTelegramBot({
      botToken: TOKEN,
      allowedChatIds: [ALLOWED],
      logger: silentLogger,
      onCommand: async () => "ok",
    });
    await bot.pollOnce();
    await bot.pollOnce();
    const polls = fetch.requests.filter((request) => request.url.endsWith("/getUpdates"));
    assert.equal((polls[0]?.body as { offset: number }).offset, 0);
    assert.equal((polls[1]?.body as { offset: number }).offset, 78);
  } finally {
    fetch.restore();
  }
});

test("an API rejection inside a 200 is reported as a failure, not read as an empty poll", async () => {
  const fetch = stubFetch(() => jsonResponse({ ok: false, description: "bot was blocked by the user" }));
  try {
    const bot = createTelegramBot({
      botToken: TOKEN,
      allowedChatIds: [ALLOWED],
      logger: silentLogger,
      onCommand: async () => "ok",
    });
    await assert.rejects(() => bot.pollOnce(), /bot was blocked by the user/);
  } finally {
    fetch.restore();
  }
});

test("the token never appears in an error, because errors are logged and shown", async () => {
  const fetch = stubFetch(() => jsonResponse({ description: "Unauthorized" }, 401));
  try {
    const bot = createTelegramBot({
      botToken: TOKEN,
      allowedChatIds: [ALLOWED],
      logger: silentLogger,
      onCommand: async () => "ok",
    });
    await bot.pollOnce().then(
      () => assert.fail("expected the poll to reject"),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /HTTP 401/);
        assert.ok(!message.includes(TOKEN), "the bot token must never reach an error message");
      },
    );
  } finally {
    fetch.restore();
  }
});
