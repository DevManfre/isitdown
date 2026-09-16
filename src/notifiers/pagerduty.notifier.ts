import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload, OverallStatus } from "../core/types.ts";
import { renderParts } from "./formatting.ts";
import { incidentKey, isResolution } from "./incidentKey.ts";

const REQUEST_TIMEOUT_MS = 10_000;

/** PagerDuty's single global ingestion endpoint for Events API v2. */
const ENQUEUE_URL = "https://events.pagerduty.com/v2/enqueue";
/** The EU service region, for an account provisioned there. */
const ENQUEUE_URL_EU = "https://events.eu.pagerduty.com/v2/enqueue";

const settingsSchema = z.object({
  /** The integration key of an Events API v2 integration on a service. */
  routingKey: z.string().min(1, "routingKey is required for the pagerduty channel"),
  /** `eu` for an account in PagerDuty's EU service region, empty for the default. */
  region: z
    .string()
    .optional()
    .refine((value) => value === undefined || value === "" || value === "eu" || value === "us", {
      message: "region must be us or eu for the pagerduty channel",
    }),
});

/**
 * PagerDuty Events API v2 — roadmap 3.7. This is the channel that stops
 * IsItDown being only a notifier: an alert here enters an on-call chain, gets
 * escalated, and has to close again on its own.
 *
 * Which is why it is a `trigger`/`resolve` pair keyed on `dedup_key` rather
 * than a message per change. The key is `incidentKey`'s, so the resolve that
 * a provider's own "resolved" update produces names the same alert the
 * "investigating" update opened, and PagerDuty closes it instead of paging
 * someone about a recovery. The lifecycle is the diff engine's, unchanged —
 * nothing here decides what happened, only how PagerDuty is told.
 *
 * A resolve for a key PagerDuty has never seen is accepted and does nothing,
 * so a recovery that arrives after a restart costs a request and not an error.
 */
export function createPagerdutyNotifier(settings: Record<string, string>): Notifier {
  const { routingKey, region } = settingsSchema.parse(settings);
  const endpoint = region === "eu" ? ENQUEUE_URL_EU : ENQUEUE_URL;

  return {
    id: "pagerduty",

    async send(payload: NotificationPayload): Promise<void> {
      const { heading, detail, url } = renderParts(payload);
      const { change } = payload;
      // A digest stands in for several changes at once; closing an alert
      // because its most severe member was a recovery would silence the rest.
      const resolving = payload.digest === undefined && isResolution(change);

      const event = {
        routing_key: routingKey,
        event_action: resolving ? "resolve" : "trigger",
        dedup_key: incidentKey(change),
        payload: {
          summary: heading,
          severity: SEVERITY[change.currentStatus],
          // The subject of the alert, in PagerDuty's own vocabulary: the thing
          // that is unhealthy, not the machine that noticed.
          source: payload.service.id,
          timestamp: change.at,
          component: change.component?.name,
          group: change.kind,
          class: change.kind,
          custom_details: {
            provider: payload.service.name,
            detail,
            previous_status: change.previousStatus,
            current_status: change.currentStatus,
          },
        },
        links: [{ href: url, text: payload.service.name }],
      };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) return;

      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        errors?: string[];
      };
      const reason = [body.message, ...(body.errors ?? [])].filter(Boolean).join("; ");
      throw new Error(
        `pagerduty notification failed: HTTP ${response.status}${reason === "" ? "" : ` (${reason})`}`,
      );
    },
  };
}

/**
 * PagerDuty's four-word severity scale. `unknown` is a warning rather than a
 * critical: our own fetching failing is worth waking a chain for, but not at
 * the level a provider declaring a major outage is.
 */
const SEVERITY: Record<OverallStatus, string> = {
  operational: "info",
  degraded: "warning",
  partial_outage: "error",
  major_outage: "critical",
  unknown: "warning",
};
