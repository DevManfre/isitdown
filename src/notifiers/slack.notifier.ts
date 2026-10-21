import { z } from "zod";
import { t } from "../core/i18n/index.ts";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { failUnlessOk, REQUEST_TIMEOUT_MS } from "./errors.ts";
import { fitText, renderParts } from "./formatting.ts";
import { httpUrlSetting } from "./settings.ts";

/** Block Kit refuses a section whose text runs past this. */
const SECTION_MAX_CHARS = 3000;

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
          text: fitText(heading, SECTION_MAX_CHARS),
          blocks: [
            { type: "section", text: { type: "mrkdwn", text: fitText(`*${heading}*\n${detail}`, SECTION_MAX_CHARS) } },
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

      await failUnlessOk("slack", response);
    },
  };
}
