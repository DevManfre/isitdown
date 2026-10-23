/** A cell's box in grid coordinates — its layout position, not where an animation has it right now. */
export interface Slot {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where a dragged widget belongs: the slot of whichever other widget is under
 * the pointer. The grid wraps, so this is a 2D hit test rather than a
 * comparison along one axis. Over a gap, or off the grid, the widget stays
 * where it is — re-slotting on every pixel of a gap is what makes a sortable
 * grid flicker.
 *
 * Slots are read from `offsetLeft`/`offsetTop`, which ignore transforms: a
 * neighbour still gliding into its new place must be hit where it is going,
 * not where it is passing through.
 */
export function dropIndex(slots: readonly Slot[], point: { x: number; y: number }, current: number): number {
  const hit = slots.findIndex(
    (slot, index) =>
      index !== current &&
      point.x >= slot.left &&
      point.x < slot.left + slot.width &&
      point.y >= slot.top &&
      point.y < slot.top + slot.height,
  );
  return hit === -1 ? current : hit;
}

/** Every cell's slot, in layout order, relative to the grid. */
export function readSlots(cells: readonly HTMLElement[]): Slot[] {
  return cells.map((cell) => ({
    left: cell.offsetLeft,
    top: cell.offsetTop,
    width: cell.offsetWidth,
    height: cell.offsetHeight,
  }));
}
