import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { ACTION_MUTE_MINUTES, encodeAction } from "../core/chatops/actions.ts";
import { t } from "../core/i18n/index.ts";
import { isResolution } from "./incidentKey.ts";
import { ChannelError, httpFailure } from "./errors.ts";
import { fitText, offersActions, renderMessage } from "./formatting.ts";

const API_TIMEOUT_MS = 10_000;

/** What `sendMessage` and `editMessageText` accept, after entity parsing. */
const TEXT_MAX_CHARS = 4096;

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
      throw httpFailure("telegram", "failed", response.status, parsed.description);
    }
    // Telegram also reports application-level failures inside a 200.
    if (parsed.ok === false) {
      throw new ChannelError(
        "telegram",
        `telegram notification rejected: ${parsed.description ?? "unknown reason"}`,
      );
    }
    return parsed;
  }

  /**
   * The buttons under a message (roadmap 3.1), or nothing.
   *
   * `inline_keyboard: []` on a message that no longer wants buttons is not the
   * same as leaving the field out: an edit that omits it keeps the old keyboard,
   * so the message that closes an incident has to ask for an empty one to take
   * the buttons away from a message that says the trouble is over. A first send
   * has nothing to remove, so there it is simply omitted.
   */
  function keyboardFor(payload: NotificationPayload, editing: boolean): { reply_markup?: unknown } {
    if (offersActions(payload)) {
      const providerId = payload.change.providerId;
      const ack = encodeAction({ kind: "ack", providerId });
      const mute = encodeAction({ kind: "mute", providerId, minutes: ACTION_MUTE_MINUTES });
      // Both or neither: an id that fits one and not the other is not worth a
      // half-keyboard, and the notification is complete without it.
      if (ack !== null && mute !== null) {
        return {
          reply_markup: {
            inline_keyboard: [
              [
                { text: t(payload.locale, "notify.action.ack"), callback_data: ack },
                { text: t(payload.locale, "notify.action.mute"), callback_data: mute },
              ],
            ],
          },
        };
      }
    }
    return editing && payload.interactive === true && isResolution(payload.change)
      ? { reply_markup: { inline_keyboard: [] } }
      : {};
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
        text: fitText(renderMessage(payload), TEXT_MAX_CHARS),
        disable_web_page_preview: true,
        ...keyboardFor(payload, false),
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
        text: fitText(renderMessage(payload), TEXT_MAX_CHARS),
        disable_web_page_preview: true,
        ...keyboardFor(payload, true),
      });
    },
  };
}
