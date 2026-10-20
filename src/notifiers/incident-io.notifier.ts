import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { httpFailure, REQUEST_TIMEOUT_MS } from "./errors.ts";
import { fitText, renderParts } from "./formatting.ts";
import { incidentKey, isResolution } from "./incidentKey.ts";

const ALERT_EVENTS_ENDPOINT = "https://api.incident.io/v2/alert_events/http";

const settingsSchema = z.object({
  /** The HTTP alert source's config id, from the alert source's setup page. */
  alertSourceId: z.string().min(1, "alertSourceId is required for the incident-io channel"),
  /** The alert source's bearer token, the credential. */
  token: z.string().min(1, "token is required for the incident-io channel"),
});

/**
 * incident.io HTTP alert source — roadmap 3.9, an on-call chain like PagerDuty.
 *
 * `deduplication_key` is `incidentKey`'s, so a `resolved` event closes the
 * alert the matching `firing` one opened. What happens next — which incident,
 * which escalation — is the alert route's business in incident.io, decided on
 * the `metadata` sent here.
 */
export function createIncidentIoNotifier(settings: Record<string, string>): Notifier {
  const { alertSourceId, token } = settingsSchema.parse(settings);
  const endpoint = `${ALERT_EVENTS_ENDPOINT}/${encodeURIComponent(alertSourceId)}`;

  return {
    id: "incident-io",

    async send(payload: NotificationPayload): Promise<void> {
      const { heading, detail, url } = renderParts(payload);
      const { change } = payload;
      // A digest stands in for several changes; see pagerduty.notifier.ts.
      const resolving = payload.digest === undefined && isResolution(change);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: fitText(heading, 1024),
          description: fitText(detail, 15_000),
          deduplication_key: incidentKey(change),
          status: resolving ? "resolved" : "firing",
          source_url: url,
          metadata: {
            provider: payload.service.id,
            provider_name: payload.service.name,
            kind: change.kind,
            status: change.currentStatus,
            previous_status: change.previousStatus ?? "",
          },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) return;

      const body = (await response.json().catch(() => ({}))) as { errors?: { message?: string }[] };
      const reason = (body.errors ?? []).map((error) => error.message).filter(Boolean).join("; ");
      throw httpFailure("incident-io", "failed", response.status, reason);
    },
  };
}
