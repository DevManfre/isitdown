import { useSyncExternalStore } from "react";

/**
 * Which providers' tiles are pulsing right now — roadmap 4.27.
 *
 * A change lands in a dense view as one dot changing colour among fifty, which
 * is exactly how it goes unnoticed. The pulse is a one-off ring on the tile that
 * moved, in a store of its own rather than component state because the tiles
 * that show a provider are in four different components and the thing that
 * notices the change is in none of them.
 *
 * It lasts `PULSE_MS` and then is gone, so the attribute that drives the CSS
 * animation goes away and can come back for the next change.
 */
export type PulseDirection = "worse" | "better";

export const PULSE_MS = 1_800;

let active: ReadonlyMap<string, PulseDirection> = new Map();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

export function pulse(id: string, direction: PulseDirection): void {
  clearTimeout(timers.get(id));
  active = new Map(active).set(id, direction);
  timers.set(
    id,
    setTimeout(() => {
      const next = new Map(active);
      next.delete(id);
      active = next;
      timers.delete(id);
      emit();
    }, PULSE_MS),
  );
  emit();
}

/** Test seam. */
export function clearPulses(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  active = new Map();
  emit();
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const snapshot = (): ReadonlyMap<string, PulseDirection> => active;

/** The pulsing set, read once per list: tiles are rendered in a `.map`, where a hook per tile cannot go. */
export const usePulses = (): ReadonlyMap<string, PulseDirection> => useSyncExternalStore(subscribe, snapshot, snapshot);

/** The attribute a tile spreads on itself: `data-pulse="worse|better"` while it is pulsing. */
export function pulseAttr(pulses: ReadonlyMap<string, PulseDirection>, id: string): { "data-pulse"?: PulseDirection } {
  const direction = pulses.get(id);
  return direction === undefined ? {} : { "data-pulse": direction };
}
