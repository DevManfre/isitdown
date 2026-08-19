import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { renderMessage } from "./formatting.ts";

const REQUEST_TIMEOUT_MS = 10_000;

const settingsSchema = z.object({
  url: z
    .string()
    .min(1, "url is required for the webhook channel")
    .refine(
      (value) => {
        let parsed: URL;
        try {
          parsed = new URL(value);
        } catch {
          return false;
        }
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      },
      { message: "url must be an http or https URL for the webhook channel" },
    ),
});

/**
 * Generic webhook: posts the structured change alongside the rendered message,
 * so a consumer can either display the text or route on the fields.
 */
export function createWebhookNotifier(settings: Record<string, string>): Notifier {
  const { url } = settingsSchema.parse(settings);

  return {
    id: "webhook",

    async send(payload: NotificationPayload): Promise<void> {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          change: payload.change,
          service: payload.service,
          message: renderMessage(payload),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`webhook notification failed: HTTP ${response.status}`);
      }
    },
  };
}
