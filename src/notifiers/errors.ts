/**
 * The one error a notifier throws when a delivery fails (roadmap 3.8).
 *
 * The dispatcher only ever reads `message`, which is what reaches the delivery
 * log, so the class changes nothing an operator sees. What it adds is a shape
 * the contract suite can hold every channel to: which channel refused, and with
 * which HTTP status when the refusal was an HTTP one — `undefined` for a
 * transport that has none (a socket that closed, a 200 whose body says no).
 *
 * The message never carries a credential. Every caller builds it from the
 * channel id, a verb and the remote side's own reason, never from a URL or a
 * header, and the contract suite checks that against every channel's secrets.
 */
export class ChannelError extends Error {
  readonly channel: string;
  readonly status: number | undefined;

  constructor(channel: string, message: string, status?: number) {
    super(message);
    this.name = "ChannelError";
    this.channel = channel;
    this.status = status;
  }
}

/**
 * The failure every HTTP channel reports, in the wording the delivery log has
 * always shown: `discord notification failed: HTTP 404 (Unknown Webhook)`.
 * Stated once so no two channels phrase the same thing differently.
 */
export function httpFailure(
  channel: string,
  verb: string,
  status: number,
  reason?: string | undefined,
): ChannelError {
  const said = reason === undefined || reason === "" ? "" : ` (${reason})`;
  return new ChannelError(channel, `${channel} notification ${verb}: HTTP ${status}${said}`, status);
}

/** The request budget every HTTP channel gives its endpoint. */
export const REQUEST_TIMEOUT_MS = 10_000;

/** The tail every plain HTTP channel shares: nothing on success, the shared failure on anything else. */
export async function failUnlessOk(channel: string, response: Response, verb = "failed"): Promise<void> {
  if (response.ok) return;
  const reason = (await response.text().catch(() => "")).trim();
  throw httpFailure(channel, verb, response.status, reason);
}
