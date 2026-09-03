import { z } from "zod";
import { t } from "../core/i18n/index.ts";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { renderParts } from "./formatting.ts";
import { httpUrlSetting } from "./settings.ts";

const REQUEST_TIMEOUT_MS = 10_000;

const settingsSchema = z.object({
  webhookUrl: httpUrlSetting("webhookUrl", "slack"),
});

/**
 * Slack incoming webhook, rendered as Block Kit: one section carrying the
 * heading and the detail, and a button to the provider's status page. The words
 * are the shared catalog's, so a Slack alert says what every other channel says.
 *
 * `text` is not the message here — Slack uses it as the notification preview on
 * a phone or in the sidebar, so it carries the heading alone rather than being
 * left out and rendering as a blank push.
 *
 * A webhook answers with a plain-text reason (`invalid_payload`, `no_service`),
 * not JSON, and the URL itself is the credential — it never appears in an error.
 */
export function createSlackNotifier(settings: Record<string, string>): Notifier {
  const { webhookUrl } = settingsSchema.parse(settings);

  return {
    id: "slack",

    async send(payload: NotificationPayload): Promise<void> {
      const { heading, detail, url } = renderParts(payload);

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: heading,
          blocks: [
            { type: "section", text: { type: "mrkdwn", text: `*${heading}*\n${detail}` } },
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: t(payload.locale, "notification.action.open-status"), emoji: true },
                  url,
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) return;

      const reason = (await response.text().catch(() => "")).trim();
      throw new Error(
        `slack notification failed: HTTP ${response.status}${reason === "" ? "" : ` (${reason})`}`,
      );
    },
  };
}
