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

/**
 * The index a drop at (x, y) should insert at, among boxes laid out in any
 * direction — a row, a column or a wrapping grid.
 *
 * The nearest box decides, and the pointer goes before or after it along
 * whichever axis it is further from the middle on: past the right edge of a
 * tall key is "after", above the top of a wide strip is "before".
 */
export function insertIndex(boxes: readonly Box[], x: number, y: number): number {
  if (boxes.length === 0) {
    return 0;
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
  const after = Math.abs(dx) / width >= Math.abs(dy) / height ? dx >= 0 : dy >= 0;
  return after ? best + 1 : best;
}
