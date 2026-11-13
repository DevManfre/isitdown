import type { Clock, ClockTimer } from "../../src/core/clock.ts";

/**
 * A clock the test moves itself (roadmap 13.2): nothing in the engine waits on
 * real time, and nothing patches `Date` for the whole process.
 *
 * `advance` fires every timer that falls due on the way, in order, the way the
 * event loop would. `sleep` is time passing, so it moves the clock by what was
 * asked and records it — backoff is asserted, never endured.
 */
export interface ManualClock extends Clock {
  advance(ms: number): void;
  setNow(at: number | string | Date): void;
  /** Every `sleep` asked for, in order. */
  readonly delays: number[];
}

export function manualClock(start: number | string | Date = "2026-09-01T10:00:00.000Z"): ManualClock {
  let at = toMs(start);
  let nextId = 1;
  const timers = new Map<number, { due: number; callback: () => void }>();
  const delays: number[] = [];

  function advanceTo(target: number): void {
    for (;;) {
      let soonest: [number, { due: number; callback: () => void }] | undefined;
      for (const entry of timers) {
        if (entry[1].due <= target && (soonest === undefined || entry[1].due < soonest[1].due)) soonest = entry;
      }
      if (soonest === undefined) break;
      timers.delete(soonest[0]);
      at = Math.max(at, soonest[1].due);
      soonest[1].callback();
    }
    at = Math.max(at, target);
  }

  return {
    delays,
    now: () => at,
    setTimeout(callback, ms) {
      const id = nextId++;
      timers.set(id, { due: at + Math.max(0, ms), callback });
      return id;
    },
    clearTimeout(timer: ClockTimer) {
      if (typeof timer === "number") timers.delete(timer);
    },
    async sleep(ms) {
      delays.push(ms);
      advanceTo(at + Math.max(0, ms));
    },
    advance: (ms) => advanceTo(at + ms),
    setNow(next) {
      advanceTo(toMs(next));
      at = toMs(next);
    },
  };
}

function toMs(value: number | string | Date): number {
  return typeof value === "number" ? value : new Date(value).getTime();
}
