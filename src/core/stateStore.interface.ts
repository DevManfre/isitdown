import type { NormalizedStatus } from "./types.ts";

export interface ProviderRuntimeState {
  /** null until the provider has been polled successfully at least once. */
  last: NormalizedStatus | null;
  /** Consecutive failed poll cycles. Reset by the first success. */
  failureCount: number;
  /** Whether the "monitoring degraded" warning has already been sent. */
  degradedNotified: boolean;
}

/**
 * The only persistence the core engine knows about. The Light edition backs it
 * with a JSON file, the UI edition with SQLite; both pass the same contract
 * suite, so they are interchangeable.
 */
export interface StateStore {
  /** Returns zeroed defaults for a provider that has never been seen. */
  getState(providerId: string): Promise<ProviderRuntimeState>;
  saveStatus(status: NormalizedStatus): Promise<void>;
  /** Returns the new consecutive-failure count. */
  recordFailure(providerId: string): Promise<number>;
  clearFailures(providerId: string): Promise<void>;
  setDegradedNotified(providerId: string, value: boolean): Promise<void>;
  close(): Promise<void>;
}
