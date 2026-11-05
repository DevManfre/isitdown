/**
 * The entry delay of the nth item in a cascade, as a CSS `animationDelay`.
 *
 * Two things every list on the dashboard needs and none of them used to get.
 *
 * A `base`, so a list starts *after* the block above it has arrived instead of
 * racing it from the same zero — the Overview's fleet rows and its hero kicker
 * both began at 0ms, which is why the top and the bottom of the page landed on
 * top of each other rather than in sequence.
 *
 * And a `cap`, so a cascade has an end. At the old flat `index * 70` the last
 * ring of a fourteen-provider band was still arriving 1.5s after the page, and
 * the providers table grew without bound with the fleet. Past the cap the tail
 * lands together, which is what an operator wants from rows they have to
 * scroll to anyway.
 *
 * The design direction (dashboard-design-direction § Motion) sets the limits
 * centrally rather than per call site: a step is never longer than
 * STAGGER_STEP, and no delay, base included, runs past STAGGER_CAP. A call
 * site can ask for less, never for more, so a list that asks for a 70ms step
 * or a 420ms cap still settles with the rest of the page. A cascade that reads
 * as unhurried at eight rows reads as a wait at forty, and the operator is
 * looking at a dashboard, not an entrance.
 */
export const STAGGER_STEP = 30;
export const STAGGER_CAP = 200;

export function stagger(
  index: number,
  {
    base = 0,
    step = STAGGER_STEP,
    cap = STAGGER_CAP,
  }: { base?: number; step?: number; cap?: number } = {},
): string {
  const ceiling = Math.min(cap, STAGGER_CAP);
  return `${Math.min(base + index * Math.min(step, STAGGER_STEP), ceiling)}ms`;
}
