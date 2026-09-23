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

/**
 * Whether a drop at `y` is past the top or bottom edge of a row — that is, a
 * row of its own rather than a place in this one.
 *
 * The band is hand-sized (a third of the row, never more than a key's worth
 * and never so wide that a row has no middle left), so dropping *into* a row
 * stays the easy thing and a new row is a deliberate reach for the edge.
 */
export function rowEdge(box: Box, y: number): 'before' | 'after' | null {
  const height = box.bottom - box.top;
  const band = Math.min(14, height / 3);
  if (y - box.top <= band) {
    return 'before';
  }
  if (box.bottom - y <= band) {
    return 'after';
  }
  return null;
}

/** The index a drop at (x, y) should insert at. */
export function insertIndex(boxes: readonly Box[], x: number, y: number): number {
  return dropPlacement(boxes, x, y).index;
}

/** Air between the bar and the canvas edge, in px. */
const BAR_INSET = 8;
/** The canvas left free under the bar, so a window can still be dropped on it. */
const DROP_BAND = 56;
/** Narrower or shorter than this, the canvas cannot hold the bar and the screen does. */
const BAR_MIN_WIDTH = 280;
const BAR_MIN_HEIGHT = 160;

/**
 * Where the arrange bar lies: on the canvas, clear of every panel it
 * rearranges, with a band of the canvas left under it to drop a window on.
 * A canvas too small for it (400 % page zoom) hands it the screen instead,
 * and the bar never runs past the screen edge — it scrolls inside itself.
 */
export function arrangeBarBox(
  stage: Box,
  view: { width: number; height: number },
): { left: number; top: number; width: number; maxHeight: number } {
  const roomy = stage.right - stage.left - 2 * BAR_INSET >= BAR_MIN_WIDTH;
  const left = roomy ? stage.left + BAR_INSET : BAR_INSET;
  const width = roomy ? stage.right - stage.left - 2 * BAR_INSET : view.width - 2 * BAR_INSET;
  const inStage = stage.bottom - stage.top - BAR_INSET - DROP_BAND >= BAR_MIN_HEIGHT;
  const top = inStage ? stage.top + BAR_INSET : BAR_INSET;
  const maxHeight = inStage
    ? stage.bottom - DROP_BAND - top
    : view.height - 2 * BAR_INSET;
  return { left, top, width, maxHeight: Math.min(maxHeight, view.height - BAR_INSET - top) };
}
