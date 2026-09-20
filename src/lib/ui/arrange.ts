/**
 * Arranging the panels by hand: where a dragged item lands.
 *
 * Pointer Events, not HTML5 drag-and-drop — the reference editors are used on
 * touch screens, where native DnD never fires (same call as LayerRows). The
 * geometry is pure so `bun test` can cover it; the DOM glue lives in
 * PanelArranger.svelte.
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Which side of which box the drop line is drawn on. */
export type Edge = 'left' | 'right' | 'top' | 'bottom';

export interface Placement {
  /** Index in the panel the item would take. */
  index: number;
  /** The box the line sits against, or null for an empty panel. */
  box: Box | null;
  edge: Edge;
}

/**
 * Where a drop at (x, y) lands among boxes laid out in any direction — a row,
 * a column or a wrapping grid.
 *
 * The nearest box decides, and the pointer goes before or after it along
 * whichever axis it is further from the middle on: past the right edge of a
 * tall key is "after", above the top of a wide strip is "before". That axis is
 * also the one the line is drawn on, so what the eye sees is what the drop does.
 */
export function dropPlacement(boxes: readonly Box[], x: number, y: number): Placement {
  if (boxes.length === 0) {
    return { index: 0, box: null, edge: 'left' };
  }
  let best = 0;
  let bestDistance = Infinity;
  for (const [i, box] of boxes.entries()) {
    const dx = x - (box.left + box.right) / 2;
    const dy = y - (box.top + box.bottom) / 2;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  const box = boxes[best];
  const dx = x - (box.left + box.right) / 2;
  const dy = y - (box.top + box.bottom) / 2;
  const width = Math.max(1, box.right - box.left);
  const height = Math.max(1, box.bottom - box.top);
  const horizontal = Math.abs(dx) / width >= Math.abs(dy) / height;
  const after = horizontal ? dx >= 0 : dy >= 0;
  return {
    index: after ? best + 1 : best,
    box,
    edge: horizontal ? (after ? 'right' : 'left') : (after ? 'bottom' : 'top'),
  };
}

/** The index a drop at (x, y) should insert at. */
export function insertIndex(boxes: readonly Box[], x: number, y: number): number {
  return dropPlacement(boxes, x, y).index;
}
