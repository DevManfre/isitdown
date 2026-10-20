import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload, OverallStatus } from "../core/types.ts";
import { httpFailure } from "./errors.ts";
import { fitText, renderParts } from "./formatting.ts";
import { incidentKey, isResolution } from "./incidentKey.ts";

const REQUEST_TIMEOUT_MS = 10_000;

const EVENTS_ENDPOINT = "https://www.zenduty.com/api/events";

const settingsSchema = z.object({
  /** An API integration's key, the credential — it travels in the path. */
  integrationKey: z.string().min(1, "integrationKey is required for the zenduty channel"),
});

/**
 * Zenduty Events API — roadmap 3.9, an on-call chain like PagerDuty.
 *
 * `entity_id` is Zenduty's de-duplication key and is `incidentKey`'s, so a
 * `resolved` event closes the alert the matching `critical` one opened. The
 * key is in the URL, so no error here includes the URL.
 */
export function createZendutyNotifier(settings: Record<string, string>): Notifier {
  const { integrationKey } = settingsSchema.parse(settings);
  const endpoint = `${EVENTS_ENDPOINT}/${encodeURIComponent(integrationKey)}/`;

  return {
    id: "zenduty",

    async send(payload: NotificationPayload): Promise<void> {
      const { heading, detail, url } = renderParts(payload);
      const { change } = payload;
      // A digest stands in for several changes; see pagerduty.notifier.ts.
      const resolving = payload.digest === undefined && isResolution(change);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          alert_type: resolving ? "resolved" : ALERT_TYPE[change.currentStatus],
          // Zenduty's own ceilings for the two text fields.
          message: fitText(heading, 512),
          summary: fitText(detail === "" ? heading : detail, 15_000),
          entity_id: incidentKey(change),
          urls: [{ link_url: url, link_text: payload.service.name }],
          payload: { provider: payload.service.id, kind: change.kind, status: change.currentStatus },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) return;

      const body = (await response.json().catch(() => ({}))) as { detail?: string; message?: string };
      throw httpFailure("zenduty", "failed", response.status, body.detail ?? body.message);
    },
  };
}

/** Zenduty's alert types; `critical` and `error` page, `warning` and `info` do not. */
const ALERT_TYPE: Record<OverallStatus, string> = {
  operational: "info",
  degraded: "warning",
  partial_outage: "error",
  major_outage: "critical",
  unknown: "warning",
};
