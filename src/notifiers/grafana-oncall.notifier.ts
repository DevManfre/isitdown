import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { httpFailure, REQUEST_TIMEOUT_MS } from "./errors.ts";
import { fitText, renderParts } from "./formatting.ts";
import { incidentKey, isResolution } from "./incidentKey.ts";
import { httpUrlSetting } from "./settings.ts";

const settingsSchema = z.object({
  /** The Formatted Webhook integration's URL, which is its credential. */
  webhookUrl: httpUrlSetting("webhookUrl", "grafana-oncall"),
});

/**
 * Grafana OnCall formatted webhook — roadmap 3.9, an on-call chain like
 * PagerDuty, for the operator whose alerting already lives in Grafana.
 *
 * `alert_uid` groups and resolves alerts in the integration's default
 * templates, so it is `incidentKey`'s: `state: "ok"` from the provider's own
 * "resolved" update resolves the group its "investigating" update opened.
 */
export function createGrafanaOncallNotifier(settings: Record<string, string>): Notifier {
  const { webhookUrl } = settingsSchema.parse(settings);

  return {
    id: "grafana-oncall",

    async send(payload: NotificationPayload): Promise<void> {
      const { heading, detail, url } = renderParts(payload);
      const { change } = payload;
      // A digest stands in for several changes; see pagerduty.notifier.ts.
      const resolving = payload.digest === undefined && isResolution(change);

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          alert_uid: incidentKey(change),
          title: fitText(heading, 1024),
          message: fitText(detail, 15_000),
          state: resolving ? "ok" : "alerting",
          link_to_upstream_details: url,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) return;

      // The URL is the credential; Grafana's answer is plain text or JSON.
      const reason = (await response.text().catch(() => "")).trim().slice(0, 200);
      throw httpFailure("grafana-oncall", "failed", response.status, reason);
    },
  };
}
