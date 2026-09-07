import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { renderMessage } from "./formatting.ts";
import { httpUrlSetting } from "./settings.ts";

const REQUEST_TIMEOUT_MS = 10_000;

const settingsSchema = z.object({
  url: httpUrlSetting("url", "webhook"),
  /**
   * Optional shared secret. Absent means unsigned, which is what every existing
   * receiver expects — turning signing on by default would break them, and a
   * receiver that does not check the header is no worse off for its presence.
   */
  secret: z.string().default(""),
});

/** The headers a signed request carries. Named here because the receiver has to read them. */
export const SIGNATURE_HEADER = "x-isitdown-signature";
export const TIMESTAMP_HEADER = "x-isitdown-timestamp";

/**
 * What the signature is computed over: the timestamp, a dot, and the exact
 * bytes of the body.
 *
 * The timestamp is in the signed material rather than merely sent alongside it,
 * so a receiver can reject a replayed request by age — a signature over the body
 * alone stays valid forever, and a captured outage alert replayed next month is
 * a page nobody can explain.
 */
export const signedPayload = (timestamp: string, body: string): string => `${timestamp}.${body}`;

/**
 * The value of the signature header: the algorithm, then the digest, in the
 * shape every other webhook signature an operator has met uses
 * (`sha256=<hex>`), so the receiving code they already have is close to right.
 */
export function signBody(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(signedPayload(timestamp, body)).digest("hex")}`;
}

/**
 * Verifies a signature the way a receiver should: constant-time, and against
 * the timestamp that was signed.
 *
 * It lives here, next to the signing, because the two have to agree exactly —
 * and because it is what the tests check the header with, which is the only way
 * a change to one of them cannot quietly stop matching the other. Receivers are
 * not IsItDown, so nothing in this codebase calls it in production.
 */
export function verifySignature(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
): boolean {
  const expected = Buffer.from(signBody(secret, timestamp, body));
  const given = Buffer.from(signature);
  // `timingSafeEqual` throws on a length mismatch, which is itself the answer.
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Generic webhook: posts the structured change alongside the rendered message,
 * so a consumer can either display the text or route on the fields.
 *
 * With a secret configured, the request also carries an HMAC-SHA256 signature
 * over the timestamp and the body (roadmap 3.16), which is what lets a receiver
 * tell a payload that came from here from one anybody could have posted to a URL
 * that is, by design, a bearer token in a query string.
 */
export function createWebhookNotifier(settings: Record<string, string>): Notifier {
  const { url, secret } = settingsSchema.parse(settings);

  return {
    id: "webhook",

    async send(payload: NotificationPayload): Promise<void> {
      // Serialised once and sent verbatim: a signature over a re-serialised
      // body is a signature over something the receiver never saw.
      const body = JSON.stringify({
        change: payload.change,
        service: payload.service,
        message: renderMessage(payload),
      });
      const timestamp = new Date().toISOString();

      const headers: Record<string, string> = { "content-type": "application/json" };
      if (secret !== "") {
        headers[TIMESTAMP_HEADER] = timestamp;
        headers[SIGNATURE_HEADER] = signBody(secret, timestamp, body);
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`webhook notification failed: HTTP ${response.status}`);
      }
    },
  };
}
