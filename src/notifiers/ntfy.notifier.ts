import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload, OverallStatus } from "../core/types.ts";
import { renderParts } from "./formatting.ts";
import { httpUrlSetting } from "./settings.ts";

const REQUEST_TIMEOUT_MS = 10_000;

const settingsSchema = z.object({
  /** The topic URL, server included: `https://ntfy.sh/my-topic`, or a self-hosted one. */
  topicUrl: httpUrlSetting("topicUrl", "ntfy"),
  /** Only needed on a server with access control; public topics take none. */
  token: z.string().default(""),
});

/**
 * ntfy — roadmap 3.4. A push notification is one POST: the body is the message,
 * and everything else travels as headers, which is why this channel needs no
 * JSON at all.
 *
 * Self-hosted push is exactly this project's audience, so the topic URL carries
 * the server: `https://ntfy.sh/isitdown` and `https://ntfy.example.com/isitdown`
 * are the same setting.
 *
 * `Priority` is what decides whether a phone rings at night, so it is mapped
 * from the severity rather than left at ntfy's default 3 for everything: an
 * operator who put a major outage on max and a recovery on low would otherwise
 * have to do it with per-topic rules on the phone instead.
 */
export function createNtfyNotifier(settings: Record<string, string>): Notifier {
  const { topicUrl, token } = settingsSchema.parse(settings);

  return {
    id: "ntfy",

    async send(payload: NotificationPayload): Promise<void> {
      const { heading, detail, url } = renderParts(payload);

      const response = await fetch(topicUrl, {
        method: "POST",
        headers: {
          // The heading is the notification's title; the body is what a phone
          // shows under it. Header values are latin-1 on the wire, so the
          // title is RFC 2047 encoded — an emoji or an Italian accent in it
          // would otherwise be mangled or refused.
          Title: encodeHeader(heading),
          Priority: String(PRIORITY[payload.change.currentStatus]),
          // Tapping the notification opens the provider's own status page,
          // which is the affordance every other channel offers as a link.
          Click: url,
          ...(token === "" ? {} : { Authorization: `Bearer ${token}` }),
        },
        body: detail === "" ? heading : detail,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) return;

      // ntfy answers an error as JSON with its own `error` text. The token is
      // the credential, so no error path here includes it.
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(
        `ntfy notification failed: HTTP ${response.status}${body.error === undefined ? "" : ` (${body.error})`}`,
      );
    },
  };
}

/**
 * ntfy's own 1–5 scale: 5 rings and bypasses do-not-disturb, 1 arrives
 * silently. `unknown` sits below default — "we cannot read the page" is worth
 * knowing, not worth waking someone.
 */
const PRIORITY: Record<OverallStatus, number> = {
  operational: 2,
  degraded: 3,
  partial_outage: 4,
  major_outage: 5,
  unknown: 2,
};

/**
 * RFC 2047 encoded-word, which is how ntfy documents a non-ASCII header value.
 * Left alone when it is already ASCII, so the common case stays readable in a
 * request log.
 */
function encodeHeader(value: string): string {
  if (!/[^ -~]/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}
