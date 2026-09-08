/**
 * Where the id of a message we already sent is kept, so the next update to the
 * same incident can edit it instead of adding another one (roadmap 3.19).
 *
 * A separate interface from `StateStore` rather than more methods on it: both
 * editions implement both on the same object, but the poller has no business
 * with message ids and the dispatcher has none with provider state, and one
 * interface would hand each of them the other's half.
 *
 * The reference is whatever the channel calls a message — a Telegram
 * `message_id`, a Discord webhook message id — and is meaningless to anything
 * but the channel that produced it, which is why the channel is part of the key.
 */
export interface MessageRefStore {
  /** Null when nothing was sent for this incident on this channel, or it was forgotten. */
  getRef(channel: string, providerId: string, incidentId: string): Promise<string | null>;
  saveRef(channel: string, providerId: string, incidentId: string, ref: string): Promise<void>;
  /**
   * Drops the reference. Called when the incident closes — the next incident
   * must start a new message — and when an edit was refused, so the fallback
   * send is not immediately followed by another attempt to edit the message it
   * replaced.
   */
  forgetRef(channel: string, providerId: string, incidentId: string): Promise<void>;
}
