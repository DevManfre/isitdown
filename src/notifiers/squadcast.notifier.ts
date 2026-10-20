import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { httpFailure } from "./errors.ts";
import { fitText, renderParts } from "./formatting.ts";
import { incidentKey, isResolution } from "./incidentKey.ts";
import { httpUrlSetting } from "./settings.ts";

const REQUEST_TIMEOUT_MS = 10_000;

const settingsSchema = z.object({
  /** The Incident Webhook integration's URL, which carries its key — the credential. */
  webhookUrl: httpUrlSetting("webhookUrl", "squadcast"),
});

/**
 * Squadcast Incident Webhook — roadmap 3.9, an on-call chain like PagerDuty.
 *
 * `event_id` is what Squadcast de-duplicates and resolves on, so it is
 * `incidentKey`'s: a `resolve` from the provider's own "resolved" update closes
 * the incident its "investigating" update triggered. Severity rides in `tags`,
 * which is where Squadcast's routing and deduplication rules read it from.
 */
export function createSquadcastNotifier(settings: Record<string, string>): Notifier {
  const { webhookUrl } = settingsSchema.parse(settings);

  return {
    id: "squadcast",

    async send(payload: NotificationPayload): Promise<void> {
      const { heading, detail, url } = renderParts(payload);
      const { change } = payload;
      // A digest stands in for several changes; see pagerduty.notifier.ts.
      const resolving = payload.digest === undefined && isResolution(change);

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: fitText(heading, 1024),
          description: fitText([detail, url].filter((part) => part !== "").join("\n\n"), 15_000),
          status: resolving ? "resolve" : "trigger",
          event_id: incidentKey(change),
          tags: {
            provider: payload.service.id,
            kind: change.kind,
            status: change.currentStatus,
          },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) return;

      // The URL is the credential, so the error carries Squadcast's words only.
      const body = (await response.json().catch(() => ({}))) as { meta?: { error_message?: string } };
      throw httpFailure("squadcast", "failed", response.status, body.meta?.error_message);
    },
  };
}
