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

  return {
    id: "telegram",

    async send(payload: NotificationPayload): Promise<void> {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: renderMessage(payload),
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });

      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        description?: string;
      };

      if (!response.ok) {
        throw new Error(
          `telegram notification failed: HTTP ${response.status}${
            body.description === undefined ? "" : ` (${body.description})`
          }`,
        );
      }
      // Telegram also reports application-level failures inside a 200.
      if (body.ok === false) {
        throw new Error(`telegram notification rejected: ${body.description ?? "unknown reason"}`);
      }
    },
  };
}
