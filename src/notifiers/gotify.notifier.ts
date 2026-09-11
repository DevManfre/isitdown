import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload, OverallStatus } from "../core/types.ts";
import { renderParts } from "./formatting.ts";
import { httpUrlSetting } from "./settings.ts";

const REQUEST_TIMEOUT_MS = 10_000;

const settingsSchema = z.object({
  /** The server, not a message path: `https://gotify.example.com`. */
  serverUrl: httpUrlSetting("serverUrl", "gotify"),
  /** An application token, the credential Gotify issues per application. */
  token: z.string().min(1, "token is required for the gotify channel"),
});

/**
 * Gotify — roadmap 3.4. Self-hosted push, like ntfy beside it, and the other
 * half of what this project's own audience already runs.
 *
 * The application token goes in the `X-Gotify-Key` header rather than the
 * `?token=` query parameter Gotify also accepts: a URL travels into logs and
 * into error messages, and the token is the credential.
 *
 * The click-through URL lives in `extras`, under the key Gotify's own clients
 * read (`client::notification.click`). A client that does not understand it
 * ignores it, and the message still says everything it says on every other
 * channel.
 */
export function createGotifyNotifier(settings: Record<string, string>): Notifier {
  const { serverUrl, token } = settingsSchema.parse(settings);
  const endpoint = `${serverUrl.replace(/\/+$/, "")}/message`;

  return {
    id: "gotify",

    async send(payload: NotificationPayload): Promise<void> {
      const { heading, detail, url } = renderParts(payload);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gotify-Key": token },
        body: JSON.stringify({
          title: heading,
          message: detail === "" ? heading : detail,
          priority: PRIORITY[payload.change.currentStatus],
          extras: { "client::notification": { click: { url } } },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) return;

      const body = (await response.json().catch(() => ({}))) as { errorDescription?: string };
      throw new Error(
        `gotify notification failed: HTTP ${response.status}${
          body.errorDescription === undefined ? "" : ` (${body.errorDescription})`
        }`,
      );
    },
  };
}

/**
 * Gotify's 0–10 scale, where its Android client starts making noise at 4 and
 * treats 8 and above as an emergency. Mapped from severity for the same reason
 * ntfy's priority is: which alert is allowed to wake someone is a property of
 * the reading, not a per-device rule an operator has to rebuild.
 */
const PRIORITY: Record<OverallStatus, number> = {
  operational: 3,
  degraded: 5,
  partial_outage: 7,
  major_outage: 9,
  unknown: 3,
};
