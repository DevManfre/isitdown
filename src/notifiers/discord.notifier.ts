import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { renderParts } from "./formatting.ts";
import { httpUrlSetting } from "./settings.ts";

const REQUEST_TIMEOUT_MS = 10_000;

const settingsSchema = z.object({
  webhookUrl: httpUrlSetting("webhookUrl", "discord"),
});

/**
 * Discord incoming webhook. One embed per change: the heading is the embed
 * title and links to the provider's status page, the severity is its colour,
 * and the words are the shared catalog's — a Discord alert says exactly what
 * the Telegram one says, arranged the way Discord renders best.
 *
 * The webhook URL is the credential, so no error path here includes it: Discord
 * answers a rejected send with its own `message`, which is what gets reported.
 *
 * Discord rate-limits a webhook to ~5 requests per 2 seconds and answers 429
 * with `retry_after`. No throttling is added here on purpose: the diff engine
 * already sends once per transition, and a notifier that swallowed or delayed
 * an alert on its own would be suppressing the thing it exists to deliver.
 */
export function createDiscordNotifier(settings: Record<string, string>): Notifier {
  const { webhookUrl } = settingsSchema.parse(settings);

  return {
    id: "discord",

    async send(payload: NotificationPayload): Promise<void> {
      const { heading, detail, url, color } = renderParts(payload);

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          embeds: [{ title: heading, url, description: detail, color }],
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) return;

      const body = (await response.json().catch(() => ({}))) as { message?: string };
      throw new Error(
        `discord notification failed: HTTP ${response.status}${
          body.message === undefined ? "" : ` (${body.message})`
        }`,
      );
    },
  };
}
