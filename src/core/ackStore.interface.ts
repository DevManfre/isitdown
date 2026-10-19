/**
 * Whether somebody has said "I'm on it" about a provider's current trouble
 * (roadmap 3.1) — the answer escalation reads before nagging a second channel
 * (roadmap 3.2).
 *
 * Its own interface, like `MessageRefStore`, rather than more methods on
 * `StateStore`: the poller has no business with who pressed a button, and the
 * dispatcher none with provider readings. Only the UI edition implements it —
 * the Light edition has nowhere to write an acknowledgement that a restart
 * would not lose, and no button to press — so anything that takes one takes it
 * as optional.
 *
 * One acknowledgement per provider, not per incident: what is being claimed is
 * "this provider's trouble is being dealt with", and a second incident opening
 * during the same outage is the same trouble to the person already on it.
 */
export interface AckRecord {
  /** ISO 8601, UTC. */
  ackedAt: string;
  /** Who pressed the button, as the surface that took the press names them. */
  ackedBy: string;
}

export interface AckStore {
  /**
   * Records the acknowledgement. Returns `false` and keeps what is there when
   * one already exists: a second press must not rewrite whose hand went up
   * first.
   */
  acknowledge(providerId: string, by: string, at: string): Promise<boolean>;
  /** Null when nobody has, or it was cleared. */
  getAck(providerId: string): Promise<AckRecord | null>;
  /** Forgets it. Idempotent; called when the trouble is over. */
  clearAck(providerId: string): Promise<void>;
}
