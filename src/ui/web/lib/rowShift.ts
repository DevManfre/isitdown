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
