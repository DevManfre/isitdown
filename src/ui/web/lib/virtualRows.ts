/** A window of rows to mount, with the height the unmounted rows stand for. */
export interface RowSpan {
  start: number;
  end: number;
  before: number;
  after: number;
}

/**
 * Which rows to mount for a table whose rows differ in height — roadmap 4.10.
 *
 * `heights` is one entry per row, measured where the row has been on screen and
 * estimated where it has not; an open accordion panel is part of its row's
 * height, which is why this is not a fixed-height division. `top` is where the
 * first row starts relative to the viewport's top edge (negative once scrolled
 * past it). The rows outside the span are not rendered at all: `before` and
 * `after` are the spacer heights that keep the scroll bar honest.
 */
export function rowSpan(
  heights: readonly number[],
  top: number,
  viewport: number,
  overscan: number,
): RowSpan {
  let offset = top;
  let first = 0;
  while (first < heights.length && offset + (heights[first] ?? 0) < 0) {
    offset += heights[first] ?? 0;
    first += 1;
  }
  let last = first;
  let reach = offset;
  while (last < heights.length && reach < viewport) {
    reach += heights[last] ?? 0;
    last += 1;
  }
  const start = Math.max(0, first - overscan);
  const end = Math.min(heights.length, last + overscan);
  const sum = (from: number, to: number): number =>
    heights.slice(from, to).reduce((total, height) => total + height, 0);
  return { start, end, before: sum(0, start), after: sum(end, heights.length) };
}
