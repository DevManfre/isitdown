import { z } from "zod";
import type { Logger } from "../core/logger.ts";

/**
 * The inbound half of the Telegram channel — roadmap 3.18.
 *
 * Long polling rather than a webhook, deliberately. A webhook would need this
 * process to be reachable from the public internet, and everything else in
 * IsItDown is built on the opposite assumption: it sits on somebody's NAS and
 * dials out. `getUpdates` keeps that true — the bot works behind a router with
 * no ports forwarded, which is where most of these installations live.
 *
 * This file is transport only. It knows how to receive a message, decide
 * whether its sender may command this bot, and send a reply; what the words
 * mean is `src/core/chatops`'s job, and lives on the far side of `onCommand`.
 */

const API_TIMEOUT_MS = 65_000;
/**
 * How long Telegram holds the request open with nothing to say. Long, because
 * every expiry is a round trip that found nothing: 50 seconds is one request a
 * minute at idle rather than one a second, and the socket timeout above leaves
 * room for the response to arrive after it.
 */
const LONG_POLL_SECONDS = 50;
/** After a failed poll, before trying again — a provider outage must not become a hot loop. */
const RETRY_DELAY_MS = 5_000;

/** Telegram refuses a button's confirmation toast longer than this. */
const TOAST_MAX_CHARS = 200;

const updateSchema = z.object({
  update_id: z.number(),
  // A press on one of the buttons a notification carries (roadmap 3.1). `message`
  // is absent when the press came from an inline-mode message, which this bot
  // never sends — such a press has no chat to authorise and is ignored.
  callback_query: z
    .object({
      id: z.string(),
      data: z.string().optional(),
      from: z.object({ id: z.union([z.number(), z.string()]), username: z.string().optional() }),
      message: z.object({ chat: z.object({ id: z.union([z.number(), z.string()]) }) }).optional(),
    })
    .optional(),
  message: z
    .object({
      text: z.string().optional(),
      chat: z.object({ id: z.union([z.number(), z.string()]) }),
      from: z.object({ id: z.union([z.number(), z.string()]), username: z.string().optional() }).optional(),
    })
    .optional(),
});

const updatesSchema = z.object({
  ok: z.boolean(),
  description: z.string().optional(),
  result: z.array(updateSchema).optional(),
});

export interface TelegramBotOptions {
  botToken: string;
  /**
   * Who may command this bot, as chat ids.
   *
   * This is the auth model the roadmap row warned about, and it is deliberately
   * the narrowest one that works: a chat is trusted because the operator
   * configured it, not because somebody in it typed a password. There is no
   * enrolment, no `/auth` command and no shared secret in the chat, because all
   * three end up pasted into the chat they are protecting. An id not on this
   * list gets silence — not a refusal, which would confirm the bot exists to
   * whoever is probing it.
   */
  allowedChatIds: readonly string[];
  /**
   * Returns the reply text, or `null` to stay silent. `by` names who sent it, the
   * way a button press names its presser, for the commands that record somebody.
   */
  onCommand: (text: string, by: string) => Promise<string | null>;
  /**
   * Handles a press on a notification's button (roadmap 3.1): the button's data
   * and who pressed it. Returns the reply, or `null` for data that is not an
   * action. Absent means the bot ignores presses entirely, which is what a bot
   * built before buttons existed did.
   *
   * Authorised exactly like a command — by the chat the button sits in — and for
   * the same reason: a button is only as trustworthy as the chat it was posted
   * to, and anybody who could press it could type `/ack` there anyway.
   */
  onCallback?: ((data: string, by: string) => Promise<string | null>) | undefined;
  logger: Logger;
}

export interface TelegramBot {
  /** Begins long polling. Returns once the first request is in flight. */
  start(): void;
  stop(): void;
  /**
   * One poll-and-answer pass, exposed so a test can drive the loop without a
   * timer: `start` is this in a `while`.
   */
  pollOnce(): Promise<number>;
}

export function createTelegramBot(options: TelegramBotOptions): TelegramBot {
  const base = `https://api.telegram.org/bot${options.botToken}`;
  const allowed = new Set(options.allowedChatIds.map((id) => String(id).trim()).filter((id) => id !== ""));
  let offset = 0;
  let running = false;

  /**
   * Every error path reports the status and Telegram's own description, never
   * the URL: the token is in the URL, and a log line or a dashboard row is
   * exactly where it must not end up. Same rule as the outbound notifier.
   */
  async function call(method: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${base}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    const parsed: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const description = (parsed as { description?: string }).description;
      throw new Error(
        `telegram ${method} failed: HTTP ${response.status}${description === undefined ? "" : ` (${description})`}`,
      );
    }
    return parsed;
  }

  /** How a person is named in what gets recorded: their handle, else their id. */
  const nameOf = (from: { id: number | string; username?: string | undefined } | undefined): string =>
    from === undefined ? "telegram" : `telegram:${from.username ?? String(from.id)}`;

  async function reply(chatId: string, text: string): Promise<void> {
    await call("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
  }

  /**
   * Stops the spinner on the pressed button, with a short toast when there is
   * something to say. Always sent for an authorised press, answered or not: a
   * button that spins for half a minute reads as a bot that has crashed.
   */
  async function answerPress(callbackQueryId: string, text: string | null): Promise<void> {
    await call("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      ...(text === null ? {} : { text: text.slice(0, TOAST_MAX_CHARS) }),
    });
  }

  async function pollOnce(): Promise<number> {
    const raw = await call("getUpdates", {
      offset,
      timeout: LONG_POLL_SECONDS,
      // Messages, and the presses on the buttons a notification carries. Not the
      // rest: asking for edits and reactions would mean receiving things this
      // bot would have to decide to ignore.
      allowed_updates: ["message", "callback_query"],
    });
    const parsed = updatesSchema.parse(raw);
    if (!parsed.ok) throw new Error(`telegram getUpdates rejected: ${parsed.description ?? "unknown reason"}`);

    let handled = 0;
    for (const update of parsed.result ?? []) {
      // Advanced before the message is acted on, and unconditionally: an update
      // that throws while being answered must not be redelivered forever. The
      // cost of the other choice is one lost reply; the cost of this one is an
      // infinite loop that never polls anything again.
      offset = Math.max(offset, update.update_id + 1);

      const press = update.callback_query;
      if (press !== undefined) {
        if (options.onCallback === undefined || press.message === undefined) continue;
        const pressChat = String(press.message.chat.id);
        if (!allowed.has(pressChat)) {
          options.logger.warn("ignored a telegram button press from a chat that is not allowed to send one", {
            chatId: pressChat,
            username: press.from.username,
          });
          continue;
        }
        const outcome = await options.onCallback(press.data ?? "", nameOf(press.from));
        await answerPress(press.id, outcome);
        if (outcome === null) continue;
        // Said to the chat as well as to the button: taking something in charge
        // is for the rest of the team to see, and a toast is seen by one person.
        await reply(pressChat, outcome);
        handled += 1;
        continue;
      }

      const message = update.message;
      const text = message?.text;
      if (message === undefined || text === undefined) continue;

      const chatId = String(message.chat.id);
      if (!allowed.has(chatId)) {
        options.logger.warn("ignored a telegram command from a chat that is not allowed to send one", {
          chatId,
          username: message.from?.username,
        });
        continue;
      }

      const answer = await options.onCommand(text, nameOf(message.from));
      if (answer === null) continue;
      await reply(chatId, answer);
      handled += 1;
    }
    return handled;
  }

  return {
    pollOnce,

    start(): void {
      if (running) return;
      running = true;
      void (async () => {
        options.logger.info("telegram chatops is listening", { chats: allowed.size });
        while (running) {
          try {
            await pollOnce();
          } catch (error) {
            if (!running) return;
            options.logger.error("a telegram chatops poll failed", {
              error: error instanceof Error ? error.message : String(error),
            });
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS).unref());
          }
        }
      })();
    },

    stop(): void {
      running = false;
    },
  };
}
