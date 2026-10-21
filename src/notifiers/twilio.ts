import { z } from "zod";
import { httpFailure, REQUEST_TIMEOUT_MS } from "./errors.ts";

const API_ROOT = "https://api.twilio.com/2010-04-01/Accounts";

/**
 * What the Twilio SMS and call channels (roadmap 3.9) share: one account, one
 * number to send from, one to reach. Two channels rather than one with a mode,
 * because routing is per channel — a text for every degradation and a call
 * only for a major outage is two routing rules, which needs two channels.
 */
export const twilioSettingsSchema = (channel: string) =>
  z.object({
    /** The account SID (`AC…`), which is also the user name for the API. */
    accountSid: z.string().min(1, `accountSid is required for the ${channel} channel`),
    /** The account's auth token, the credential. */
    authToken: z.string().min(1, `authToken is required for the ${channel} channel`),
    /** A Twilio number, E.164: `+15005550006`. */
    from: z.string().min(1, `from is required for the ${channel} channel`),
    /** The number reached, E.164. */
    to: z.string().min(1, `to is required for the ${channel} channel`),
  });

export type TwilioSettings = z.infer<ReturnType<typeof twilioSettingsSchema>>;

/**
 * One POST to an account resource (`Messages`, `Calls`), form-encoded as Twilio
 * documents, with the credentials in the `Authorization` header — never in the
 * URL, which travels into logs and error messages.
 */
export async function twilioPost(
  channel: string,
  settings: TwilioSettings,
  resource: string,
  fields: Record<string, string>,
): Promise<void> {
  const form = new URLSearchParams({ To: settings.to, From: settings.from, ...fields });
  const response = await fetch(`${API_ROOT}/${encodeURIComponent(settings.accountSid)}/${resource}.json`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${settings.accountSid}:${settings.authToken}`).toString("base64")}`,
    },
    body: form.toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.ok) return;

  // Twilio's own sentence names the field it objected to ("The 'To' number …").
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  throw httpFailure(channel, "failed", response.status, body.message);
}
