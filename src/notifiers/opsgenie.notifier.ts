import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload, OverallStatus } from "../core/types.ts";
import { renderParts } from "./formatting.ts";
import { incidentKey, isResolution } from "./incidentKey.ts";

const REQUEST_TIMEOUT_MS = 10_000;

const API_URL = "https://api.opsgenie.com/v2/alerts";
/** The EU instance, for an account provisioned there. */
const API_URL_EU = "https://api.eu.opsgenie.com/v2/alerts";

const settingsSchema = z.object({
  /** An API key from an Opsgenie API integration; the credential. */
  apiKey: z.string().min(1, "apiKey is required for the opsgenie channel"),
  /** `eu` for an account on Opsgenie's EU instance, empty for the default. */
  region: z
    .string()
    .optional()
    .refine((value) => value === undefined || value === "" || value === "eu" || value === "us", {
      message: "region must be us or eu for the opsgenie channel",
    }),
});

/**
 * Opsgenie Alerts API — roadmap 3.7, the other half of the on-call pair.
 *
 * Opsgenie's `alias` is PagerDuty's `dedup_key` under another name, so both
 * channels derive theirs from the same `incidentKey`: an alert opened by a
 * provider's "investigating" update is the one closed by its "resolved" one.
 * A close is its own endpoint (`/alerts/{identifier}/close`) rather than an
 * action on the create call, which is the only shape difference worth noticing
 * between the two.
 *
 * Closing an alias Opsgenie has never seen answers 404; that is reported like
 * any other failure rather than swallowed — an alert that never opened is
 * worth a line in the delivery log, and the recovery it belongs to is already
 * on every other channel.
 */
export function createOpsgenieNotifier(settings: Record<string, string>): Notifier {
  const { apiKey, region } = settingsSchema.parse(settings);
  const root = region === "eu" ? API_URL_EU : API_URL;
  const headers = { "content-type": "application/json", authorization: `GenieKey ${apiKey}` };

  /** Whatever went wrong, in Opsgenie's own words and never with the key. */
  async function fail(response: Response, verb: string): Promise<never> {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(
      `opsgenie notification ${verb}: HTTP ${response.status}${
        body.message === undefined ? "" : ` (${body.message})`
      }`,
    );
  }

  return {
    id: "opsgenie",

    async send(payload: NotificationPayload): Promise<void> {
      const { heading, detail, url } = renderParts(payload);
      const { change } = payload;
      const alias = incidentKey(change);
      // A digest stands in for several changes at once; closing an alert
      // because its most severe member was a recovery would silence the rest.
      const resolving = payload.digest === undefined && isResolution(change);

      if (resolving) {
        const response = await fetch(
          `${root}/${encodeURIComponent(alias)}/close?identifierType=alias`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ source: "IsItDown", note: heading }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          },
        );
        if (!response.ok) await fail(response, "close failed");
        return;
      }

      const response = await fetch(root, {
        method: "POST",
        headers,
        // Opsgenie caps the message at 130 characters and silently truncates
        // past it; the heading is one line by construction, and the detail goes
        // to `description`, which has room for it.
        body: JSON.stringify({
          message: heading.slice(0, 130),
          alias,
          description: [detail, url].filter((part) => part !== "").join("\n\n"),
          priority: PRIORITY[change.currentStatus],
          source: "IsItDown",
          entity: payload.service.id,
          tags: ["isitdown", change.kind],
          details: {
            provider: payload.service.name,
            previousStatus: change.previousStatus ?? "",
            currentStatus: change.currentStatus,
            statusUrl: url,
          },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) await fail(response, "failed");
    },
  };
}

/**
 * Opsgenie's P1–P5 scale. Mapped from severity for the same reason every push
 * channel's priority is: which alert is allowed to wake someone is a property
 * of the reading, not a per-team rule an operator has to rebuild.
 */
const PRIORITY: Record<OverallStatus, string> = {
  operational: "P5",
  degraded: "P3",
  partial_outage: "P2",
  major_outage: "P1",
  unknown: "P3",
};
