import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload, OverallStatus } from "../core/types.ts";
import { httpFailure } from "./errors.ts";
import { fitText, renderParts } from "./formatting.ts";
import { incidentKey, isResolution } from "./incidentKey.ts";

const REQUEST_TIMEOUT_MS = 10_000;

/** The REST endpoint integration's root; the key and the routing key follow it in the path. */
const REST_ENDPOINT = "https://alert.victorops.com/integrations/generic/20131114/alert";

const settingsSchema = z.object({
  /** The REST integration's API key, the credential — it travels in the path. */
  apiKey: z.string().min(1, "apiKey is required for the splunk-oncall channel"),
  /** Which routing key, and so which escalation policy, the alert lands on. */
  routingKey: z.string().min(1, "routingKey is required for the splunk-oncall channel"),
});

/**
 * Splunk On-Call (formerly VictorOps) REST endpoint — roadmap 3.9, one more
 * on-call chain beside PagerDuty and Opsgenie, built the same way.
 *
 * `entity_id` is this system's de-duplication key, so it is `incidentKey`'s:
 * the RECOVERY a provider's own "resolved" update produces closes the incident
 * its "investigating" update opened, instead of paging about a recovery.
 *
 * The API key is part of the URL, so no error path here includes the URL —
 * only the status and the `message` Splunk answers with.
 */
export function createSplunkOncallNotifier(settings: Record<string, string>): Notifier {
  const { apiKey, routingKey } = settingsSchema.parse(settings);
  const endpoint = `${REST_ENDPOINT}/${encodeURIComponent(apiKey)}/${encodeURIComponent(routingKey)}`;

  return {
    id: "splunk-oncall",

    async send(payload: NotificationPayload): Promise<void> {
      const { heading, detail, url } = renderParts(payload);
      const { change } = payload;
      // A digest stands in for several changes at once; closing an alert
      // because its most severe member was a recovery would silence the rest.
      const resolving = payload.digest === undefined && isResolution(change);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message_type: resolving ? "RECOVERY" : MESSAGE_TYPE[change.currentStatus],
          entity_id: incidentKey(change),
          entity_display_name: fitText(heading, 1024),
          state_message: fitText([detail, url].filter((part) => part !== "").join("\n\n"), 15_000),
          state_start_time: Math.floor(Date.parse(change.at) / 1000),
          monitoring_tool: "IsItDown",
          provider: payload.service.name,
          status_url: url,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) return;

      const body = (await response.json().catch(() => ({}))) as { message?: string };
      throw httpFailure("splunk-oncall", "failed", response.status, body.message);
    },
  };
}

/**
 * Splunk On-Call's message types. Only CRITICAL pages; WARNING and INFO land
 * on the timeline without waking anyone, which is where a degraded reading or
 * our own fetching trouble belongs.
 */
const MESSAGE_TYPE: Record<OverallStatus, string> = {
  operational: "INFO",
  degraded: "WARNING",
  partial_outage: "CRITICAL",
  major_outage: "CRITICAL",
  unknown: "WARNING",
};
