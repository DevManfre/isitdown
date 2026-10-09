import type { DampingState, Freshness, NormalizedStatus, Suspicion } from "./types.ts";

export interface ProviderRuntimeState {
  /** null until the provider has been polled successfully at least once. */
  last: NormalizedStatus | null;
  /** Consecutive failed poll cycles. Reset by the first success. */
  failureCount: number;
  /** Whether the "monitoring degraded" warning has already been sent. */
  degradedNotified: boolean;
  /**
   * The reading the operator was last notified about, which is what the next
   * poll is compared against. It moves independently of `last`: while flap
   * damping holds an unconfirmed transition, samples keep being recorded but
   * this stays put, so the transition is announced a poll later rather than
   * lost. Null on a store written before damping existed — `last` stands in.
   */
  notifyBaseline: NormalizedStatus | null;
  /** The transition being held, if any. Null when nothing is pending. */
  pending: DampingState | null;
  /**
   * Readings that contradict the page without the page admitting them —
   * roadmap 1.3. One per probe that accuses this provider; empty when none
   * does. Persisted so a restart neither forgets an open disagreement nor
   * announces it a second time.
   */
  suspicions: Suspicion[];
  /**
   * How long the reading has looked the same — roadmap 1.8. Null until a page
   * adapter has read the provider once; never set for a probe.
   */
  freshness: Freshness | null;
}

/** What the poller observed while taking a reading, beyond the reading itself. */
export interface SaveStatusMeta {
  /**
   * How long the provider's page took to answer the read behind this status.
   * Absent when the reading came from somewhere that did not measure one.
   */
  latencyMs?: number | undefined;
  /**
   * Which revision of the adapter produced this reading — roadmap 10.4. See
   * `Adapter.version` for why a sample has to carry it. Absent when the caller
   * did not name one, which the store records as 1.
   */
  adapterVersion?: number | undefined;
}

/**
 * The only persistence the core engine knows about. The Light edition backs it
 * with a JSON file, the UI edition with SQLite; both pass the same contract
 * suite, so they are interchangeable.
 */
export interface StateStore {
  /** Returns zeroed defaults for a provider that has never been seen. */
  getState(providerId: string): Promise<ProviderRuntimeState>;
  saveStatus(status: NormalizedStatus, meta?: SaveStatusMeta | undefined): Promise<void>;
  /** Returns the new consecutive-failure count. */
  recordFailure(providerId: string): Promise<number>;
  clearFailures(providerId: string): Promise<void>;
  setDegradedNotified(providerId: string, value: boolean): Promise<void>;
  /**
   * Persists what the notification gate decided: the baseline the next poll
   * compares against, and the transition still being held. Written once per
   * successful poll, right after the status itself.
   */
  saveNotifyState(
    providerId: string,
    baseline: NormalizedStatus | null,
    pending: DampingState | null,
  ): Promise<void>;
  /** Replaces the provider's open suspicions (roadmap 1.3); an empty list clears them. */
  setSuspicions(providerId: string, suspicions: Suspicion[]): Promise<void>;
  /** Replaces the provider's freshness (roadmap 1.8). */
  setFreshness(providerId: string, freshness: Freshness): Promise<void>;
  close(): Promise<void>;
}
