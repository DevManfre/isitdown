import type { NotificationPayload } from "./types.ts";

export interface Notifier {
  /** The channel id, e.g. "telegram". */
  id: string;
  /**
   * Throws on delivery failure; the dispatcher isolates and records it.
   *
   * Returns the channel's own id for the message it just posted, when the
   * channel has one and can edit it later (roadmap 3.19). Returning nothing is
   * the normal case and means "this message cannot be revisited" — a Slack
   * incoming webhook, a web push toast — which is exactly what a channel
   * without `update` below is.
   */
  send(payload: NotificationPayload): Promise<string | void>;
  /**
   * Rewrites a message this channel posted before, named by the reference
   * `send` returned. Absent on channels that cannot edit, which is how the
   * dispatcher decides whether to try: a channel that had to throw
   * "unsupported" here would report every incident update as a failed delivery.
   *
   * Throwing means "this message could not be edited" — too old, deleted by
   * hand — and the dispatcher answers by sending a new one, so an edit that
   * cannot happen costs an extra message rather than a lost alert.
   */
  update?(payload: NotificationPayload, ref: string): Promise<void>;
}
