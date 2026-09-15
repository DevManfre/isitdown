import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload, OverallStatus } from "../core/types.ts";
import { renderParts } from "./formatting.ts";
import { httpUrlSetting } from "./settings.ts";

const REQUEST_TIMEOUT_MS = 10_000;

const settingsSchema = z.object({
  /**
   * The URL a Teams channel gives out — a Power Automate workflow trigger, or
   * an Office 365 connector on an instance that still has one.
   */
  webhookUrl: httpUrlSetting("webhookUrl", "teams"),
});

/**
 * Microsoft Teams — roadmap 3.8. One incoming webhook, one Adaptive Card.
 *
 * The card is sent in the `attachments` envelope rather than as the older
 * `MessageCard`: Microsoft retired the Office 365 connectors in favour of
 * Workflows, and a workflow trigger only understands this shape. A connector
 * that is still alive renders it too, so there is one body rather than a
 * setting asking the operator which era their webhook belongs to.
 *
 * Severity travels as the heading's own colour — Adaptive Cards name colours
 * (`good`/`warning`/`attention`) instead of taking the hex `formatting.ts`
 * hands the channels that can use one — plus the same emoji every other
 * channel shows, so a client rendering the card in monochrome still says it.
 *
 * Teams answers a rejected send with a plain-text reason rather than JSON, so
 * that is what the error carries.
 */
export function createTeamsNotifier(settings: Record<string, string>): Notifier {
  const { webhookUrl } = settingsSchema.parse(settings);

  return {
    id: "teams",

    async send(payload: NotificationPayload): Promise<void> {
      const { heading, detail, url } = renderParts(payload);

      const body = [
        {
          type: "TextBlock",
          text: heading,
          weight: "Bolder",
          size: "Medium",
          wrap: true,
          color: CARD_COLOR[payload.change.currentStatus],
        },
        // A change whose whole report is its heading repeats it rather than
        // sending an empty block, which Teams renders as a gap.
        { type: "TextBlock", text: detail === "" ? heading : detail, wrap: true },
      ];

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "message",
          attachments: [
            {
              contentType: "application/vnd.microsoft.card.adaptive",
              contentUrl: null,
              content: {
                $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
                type: "AdaptiveCard",
                version: "1.4",
                body,
                // The status page is a button, not a line of text — the same
                // tap target every other channel gives it.
                actions: [{ type: "Action.OpenUrl", title: payload.service.name, url }],
              },
            },
          ],
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) return;

      // The webhook URL is the credential, so it never appears in the error.
      const reason = (await response.text().catch(() => "")).trim().slice(0, 200);
      throw new Error(
        `teams notification failed: HTTP ${response.status}${reason === "" ? "" : ` (${reason})`}`,
      );
    },
  };
}

/**
 * Adaptive Cards have an enum, not a palette: `attention` is the client's own
 * red, `warning` its amber, `good` its green. Reading them from the client
 * rather than sending a hex is what keeps the card legible in both of Teams'
 * themes. `unknown` stays `default` — a reading we could not take is not an
 * alarm.
 */
const CARD_COLOR: Record<OverallStatus, string> = {
  operational: "good",
  degraded: "warning",
  partial_outage: "attention",
  major_outage: "attention",
  unknown: "default",
};
