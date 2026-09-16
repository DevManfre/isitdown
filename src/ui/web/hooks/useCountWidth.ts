import { useRef } from "react";

/**
 * How much room a filter chip's count needs, in `ch`.
 *
 * The counts on the Incidents and Delivery log chips are tallies of whatever
 * the current window or channel admits, so they run 0 → 232 → 4 as the
 * operator narrows. Each digit that appears or goes widens or narrows the
 * chip, which moves the chips after it, the search field and the download
 * button beside them — the row slid sideways every time the window changed,
 * and again on every frame of the ticker counting up to its target.
 *
 * Reserving the width kills both. It is a high-water mark rather than the
 * current figure because the figure itself is what shrinks: hold the widest
 * tally this view has shown, and a narrower window changes the digits without
 * ever pulling the row back in.
 */
export function useCountWidth(value: number): string {
  const widest = useRef(0);
  // Written during render, which is safe because it only ever grows and the
  // same input always yields the same output — a double-invoked render in
  // StrictMode reaches the same mark.
  widest.current = Math.max(widest.current, Math.abs(Math.trunc(value)));
  return `${String(widest.current).length}ch`;
}
