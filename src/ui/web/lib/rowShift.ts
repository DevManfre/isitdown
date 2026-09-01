/**
 * How far each row has to be put back for a layout change to be played as
 * motion instead of a jump: the "invert" half of a FLIP, in pixels along Y.
 *
 * A row that has just arrived, has just gone, or has not moved yields nothing —
 * only a row both measurements share and that changed position needs offsetting
 * before it can be released into its new slot.
 */
export function rowShifts(
  previous: ReadonlyMap<string, number>,
  current: ReadonlyMap<string, number>,
): Map<string, number> {
  const shifts = new Map<string, number>();
  for (const [id, top] of current) {
    const was = previous.get(id);
    if (was !== undefined && was !== top) shifts.set(id, was - top);
  }
  return shifts;
}

/**
 * Whether a layout change is one a FLIP is for at all: rows swapping places,
 * arriving, or leaving. The sequence of ids is what says so.
 *
 * An accordion panel unfolding under a row shoves everything below it down
 * without touching which rows are on the page or in what order, and that
 * motion is the panel's own animation to play. Replaying it as a FLIP fights
 * it — and worse, the panel keeps growing after the commit that mounted it,
 * with no render to re-measure on, so the offsets left behind go stale and the
 * next unrelated render reads the whole unfold as a jump that never happened.
 */
export function isReorder(previous: readonly string[], current: readonly string[]): boolean {
  return previous.length !== current.length || previous.some((id, index) => current[index] !== id);
}
