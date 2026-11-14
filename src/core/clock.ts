/**
 * The one way the engine reads the time and waits — roadmap 13.2.
 *
 * Polling cadence, retry backoff, the digest window, quiet hours and the hourly
 * cap all turn on the clock. Taking it as a dependency rather than reaching for
 * `Date.now()` and `setTimeout` is what lets a test stand at 23:59 on the night
 * the clocks change and step across it, instead of negotiating with the real
 * one or patching `Date` for the whole process.
 */
export interface Clock {
  /** Milliseconds since the epoch, like `Date.now()`. */
  now(): number;
  setTimeout(callback: () => void, ms: number): ClockTimer;
  clearTimeout(timer: ClockTimer): void;
  /** Resolves once `ms` have passed on this clock. */
  sleep(ms: number): Promise<void>;
}

/** A handle only the clock that issued it can cancel. */
export type ClockTimer = NodeJS.Timeout | number;

/** The wall clock, and the default wherever a clock is optional. */
export const systemClock: Clock = {
  now: () => Date.now(),
  // Deliberately referenced, as the scheduler always was: its timer is the only
  // thing keeping the Light edition's event loop alive between cycles.
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (timer) => clearTimeout(timer as NodeJS.Timeout),
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
};
