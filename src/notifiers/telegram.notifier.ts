import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { renderMessage } from "./formatting.ts";

const API_TIMEOUT_MS = 10_000;

const settingsSchema = z.object({
  botToken: z.string().min(1, "botToken is required for the telegram channel"),
  chatId: z.string().min(1, "chatId is required for the telegram channel"),
});

export type TelegramSettings = z.infer<typeof settingsSchema>;

/**
 * Telegram Bot API. The token is part of the request URL, so every error path
 * here reports the HTTP status and the API's own description — never the URL,
 * which would leak the token into logs and into the UI's notification feed.
 */
export function createTelegramNotifier(settings: Record<string, string>): Notifier {
  const { botToken, chatId } = settingsSchema.parse(settings);
  const endpoint = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const editEndpoint = `https://api.telegram.org/bot${botToken}/editMessageText`;

  /**
   * One call to the Bot API, with the two failure shapes it has: an HTTP error,
   * and a 200 whose body says `ok: false`. Shared by both methods below so an
   * edit cannot end up reporting failures differently from a send.
   */
  async function call(url: string, body: unknown): Promise<{ result?: { message_id?: number } }> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    const parsed = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number };
    };

    if (!response.ok) {
      throw new Error(
        `telegram notification failed: HTTP ${response.status}${
          parsed.description === undefined ? "" : ` (${parsed.description})`
        }`,
      );
    }
    // Telegram also reports application-level failures inside a 200.
    if (parsed.ok === false) {
      throw new Error(`telegram notification rejected: ${parsed.description ?? "unknown reason"}`);
    }
    return parsed;
  }

  return {
    id: "telegram",

    /**
     * Returns the `message_id` Telegram assigned, which is what `update` below
     * needs. A response without one is not a failure — the message was sent —
     * so the dispatcher simply has nothing to edit later.
     */
    async send(payload: NotificationPayload): Promise<string | void> {
      const parsed = await call(endpoint, {
        chat_id: chatId,
        text: renderMessage(payload),
        disable_web_page_preview: true,
      });
      const id = parsed.result?.message_id;
      return typeof id === "number" ? String(id) : undefined;
    },

    /**
     * Rewrites a message already in the chat (roadmap 3.19). Telegram refuses
     * an edit older than 48 hours, and refuses one whose text is unchanged —
     * both come back as a rejection here and the dispatcher answers with a
     * fresh message, which is why nothing is swallowed.
     */
    async update(payload: NotificationPayload, ref: string): Promise<void> {
      await call(editEndpoint, {
        chat_id: chatId,
        message_id: Number(ref),
        text: renderMessage(payload),
        disable_web_page_preview: true,
      });
    },
  };
}
