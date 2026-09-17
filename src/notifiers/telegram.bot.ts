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

const updateSchema = z.object({
  update_id: z.number(),
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
  /** Returns the reply text, or `null` to stay silent. */
  onCommand: (text: string) => Promise<string | null>;
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

  async function reply(chatId: string, text: string): Promise<void> {
    await call("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
  }

  async function pollOnce(): Promise<number> {
    const raw = await call("getUpdates", {
      offset,
      timeout: LONG_POLL_SECONDS,
      // Only messages: this bot has no buttons and no inline mode, and asking
      // for the rest would mean receiving edits and reactions it would have to
      // decide to ignore.
      allowed_updates: ["message"],
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

      const answer = await options.onCommand(text);
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
