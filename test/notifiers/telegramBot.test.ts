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

// Roadmap 3.1: a press on a notification's button arrives as a callback_query.
function pressing(presses: { id: number; chat: string; data: string; from?: { id: number; username?: string } }[]) {
  let served = false;
  return (request: CapturedRequest): Response => {
    if (request.url.endsWith("/getUpdates")) {
      const result = served
        ? []
        : presses.map((press) => ({
            update_id: press.id,
            callback_query: {
              id: `cb${press.id}`,
              data: press.data,
              from: press.from ?? { id: 42, username: "op" },
              message: { message_id: 7, chat: { id: press.chat } },
            },
          }));
      served = true;
      return jsonResponse({ ok: true, result });
    }
    return jsonResponse({ ok: true, result: { message_id: 1 } });
  };
}

const callsTo = (requests: CapturedRequest[], method: string) =>
  requests.filter((request) => request.url.endsWith(`/${method}`));

test("polling asks for button presses as well as messages", async () => {
  const fetch = stubFetch(respondWith([]));
  try {
    const bot = createTelegramBot({
      botToken: TOKEN,
      allowedChatIds: [ALLOWED],
      logger: silentLogger,
      onCommand: async () => null,
      onCallback: async () => null,
    });
    await bot.pollOnce();
    const poll = callsTo(fetch.requests, "getUpdates")[0]?.body as { allowed_updates: string[] };
    assert.deepEqual(poll.allowed_updates, ["message", "callback_query"]);
  } finally {
    fetch.restore();
  }
});

test("a press in an allowed chat reaches the handler with who pressed, and the answer goes to the chat and the button", async () => {
  const fetch = stubFetch(pressing([{ id: 20, chat: ALLOWED, data: "ack:github" }]));
  const seen: { data: string; by: string }[] = [];
  try {
    const bot = createTelegramBot({
      botToken: TOKEN,
      allowedChatIds: [ALLOWED],
      logger: silentLogger,
      onCommand: async () => null,
      onCallback: async (data, by) => {
        seen.push({ data, by });
        return "GitHub: taken in charge by telegram:op.";
      },
    });
    assert.equal(await bot.pollOnce(), 1);
    assert.deepEqual(seen, [{ data: "ack:github", by: "telegram:op" }]);
    // The chat is told, because the point of taking something in charge is that
    // the rest of the team can see it; the button's own spinner is stopped too.
    assert.deepEqual(
      sends(fetch.requests).map((request) => request.body),
      [{ chat_id: ALLOWED, text: "GitHub: taken in charge by telegram:op.", disable_web_page_preview: true }],
    );
    assert.deepEqual(
      callsTo(fetch.requests, "answerCallbackQuery").map((request) => request.body),
      [{ callback_query_id: "cb20", text: "GitHub: taken in charge by telegram:op." }],
    );
  } finally {
    fetch.restore();
  }
});

test("a presser with no username is named by their id", async () => {
  const fetch = stubFetch(pressing([{ id: 21, chat: ALLOWED, data: "ack:github", from: { id: 99 } }]));
  const seen: string[] = [];
  try {
    const bot = createTelegramBot({
      botToken: TOKEN,
      allowedChatIds: [ALLOWED],
      logger: silentLogger,
      onCommand: async () => null,
      onCallback: async (_data, by) => {
        seen.push(by);
        return "ok";
      },
    });
    await bot.pollOnce();
    assert.deepEqual(seen, ["telegram:99"]);
  } finally {
    fetch.restore();
  }
});

test("a press from a chat that is not allowed is ignored without a word", async () => {
  const fetch = stubFetch(pressing([{ id: 22, chat: "-100999", data: "mute:github:120" }]));
  let asked = false;
  try {
    const bot = createTelegramBot({
      botToken: TOKEN,
      allowedChatIds: [ALLOWED],
      logger: silentLogger,
      onCommand: async () => null,
      onCallback: async () => {
        asked = true;
        return "muted";
      },
    });
    assert.equal(await bot.pollOnce(), 0);
    assert.equal(asked, false, "an unauthorised chat must never reach the action handler");
    assert.deepEqual(sends(fetch.requests), []);
    assert.deepEqual(callsTo(fetch.requests, "answerCallbackQuery"), []);
  } finally {
    fetch.restore();
  }
});

test("a press the handler does not recognise still stops the button's spinner, and says nothing in the chat", async () => {
  const fetch = stubFetch(pressing([{ id: 23, chat: ALLOWED, data: "something:else" }]));
  try {
    const bot = createTelegramBot({
      botToken: TOKEN,
      allowedChatIds: [ALLOWED],
      logger: silentLogger,
      onCommand: async () => null,
      onCallback: async () => null,
    });
    assert.equal(await bot.pollOnce(), 0);
    assert.deepEqual(sends(fetch.requests), []);
    assert.deepEqual(
      callsTo(fetch.requests, "answerCallbackQuery").map((request) => request.body),
      [{ callback_query_id: "cb23" }],
    );
  } finally {
    fetch.restore();
  }
});

test("a bot built without a press handler leaves presses alone", async () => {
  const fetch = stubFetch(pressing([{ id: 24, chat: ALLOWED, data: "ack:github" }]));
  try {
    const bot = createTelegramBot({
      botToken: TOKEN,
      allowedChatIds: [ALLOWED],
      logger: silentLogger,
      onCommand: async () => "x",
    });
    assert.equal(await bot.pollOnce(), 0);
    assert.deepEqual(sends(fetch.requests), []);
  } finally {
    fetch.restore();
  }
});

test("a press that is answered with an overlong reply is cut for the toast, never for the chat", async () => {
  const long = "x".repeat(500);
  const fetch = stubFetch(pressing([{ id: 25, chat: ALLOWED, data: "ack:github" }]));
  try {
    const bot = createTelegramBot({
      botToken: TOKEN,
      allowedChatIds: [ALLOWED],
      logger: silentLogger,
      onCommand: async () => null,
      onCallback: async () => long,
    });
    await bot.pollOnce();
    assert.equal((sends(fetch.requests)[0]?.body as { text: string }).text, long);
    const toast = (callsTo(fetch.requests, "answerCallbackQuery")[0]?.body as { text: string }).text;
    assert.ok(toast.length <= 200, `Telegram refuses a toast over 200 characters, got ${toast.length}`);
  } finally {
    fetch.restore();
  }
});

test("a typed command is handed who typed it, named the way a button press is", async () => {
  const fetch = stubFetch(respondWith([{ id: 30, chat: ALLOWED, text: "/ack github" }]));
  const seen: string[] = [];
  try {
    const bot = createTelegramBot({
      botToken: TOKEN,
      allowedChatIds: [ALLOWED],
      logger: silentLogger,
      onCommand: async (_text, by) => {
        seen.push(by);
        return "ok";
      },
    });
    await bot.pollOnce();
    assert.deepEqual(seen, ["telegram:op"]);
  } finally {
    fetch.restore();
  }
});
