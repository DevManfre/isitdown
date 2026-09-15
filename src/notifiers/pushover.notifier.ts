import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload, OverallStatus } from "../core/types.ts";
import { renderParts } from "./formatting.ts";

const REQUEST_TIMEOUT_MS = 10_000;

/** The one endpoint Pushover has for sending; there is no self-hosted variant. */
const MESSAGES_ENDPOINT = "https://api.pushover.net/1/messages.json";

const settingsSchema = z.object({
  /** The application's API token, created once per application in Pushover. */
  token: z.string().min(1, "token is required for the pushover channel"),
  /** The user or group key the message is delivered to. */
  userKey: z.string().min(1, "userKey is required for the pushover channel"),
  /** Narrow delivery to one registered device; empty means every device. */
  device: z.string().default(""),
});

/**
 * Pushover — roadmap 3.5. Two credentials and one POST: the application token
 * says who is sending, the user key says who receives, and everything else is a
 * form field.
 *
 * Form-encoded rather than JSON because that is the body Pushover documents,
 * and because it keeps the credentials out of the URL — a query string travels
 * into logs and into error messages, and both fields here are secrets.
 *
 * The status page is the notification's tap target (`url`), not a line in the
 * text, the way it is on every other push channel here.
 */
export function createPushoverNotifier(settings: Record<string, string>): Notifier {
  const { token, userKey, device } = settingsSchema.parse(settings);

  return {
    id: "pushover",

    async send(payload: NotificationPayload): Promise<void> {
      const { heading, detail, url } = renderParts(payload);

      const form = new URLSearchParams({
        token,
        user: userKey,
        title: heading,
        // Pushover refuses an empty message, so a change whose whole report is
        // its heading sends the heading as the body too.
        message: detail === "" ? heading : detail,
        url,
        url_title: payload.service.name,
        priority: String(PRIORITY[payload.change.currentStatus]),
      });
      if (device !== "") form.set("device", device);

      const response = await fetch(MESSAGES_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        // Serialised here rather than handed over as a `URLSearchParams`: the
        // body that goes out is the string, and sending the string is what
        // makes the content-type above the only thing describing it.
        body: form.toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) return;

      // Pushover answers a rejection with the field it objected to, which is the
      // sentence an operator can act on. Neither credential is ever echoed.
      const body = (await response.json().catch(() => ({}))) as { errors?: string[] };
      const reason = body.errors?.join(", ");
      throw new Error(
        `pushover notification failed: HTTP ${response.status}${
          reason === undefined || reason === "" ? "" : ` (${reason})`
        }`,
      );
    },
  };
}

/**
 * Pushover's -2…2 scale. 1 is "high": it bypasses the user's quiet hours, which
 * is what an outage is for. 2 is deliberately never used — an emergency
 * priority needs `retry` and `expire` and re-alerts until someone acknowledges
 * it, which is an on-call escalation (roadmap 3.7), not a status change.
 * `unknown` sits at -1 so "we cannot read the page" arrives silently.
 */
const PRIORITY: Record<OverallStatus, number> = {
  operational: 0,
  degraded: 0,
  partial_outage: 1,
  major_outage: 1,
  unknown: -1,
};
