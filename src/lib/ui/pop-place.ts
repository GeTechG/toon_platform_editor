/**
 * Where a key's window opens (PopKey.svelte). Pure, so `bun test` runs it.
 */

export interface PlatePlace {
  x: number;
  top?: number;
  bottom?: number;
  /** The tallest the window may be drawn. */
  max: number;
}

/** The gap between a key and its window, px. */
const GAP = 6;
/** The window's edge the plate keeps clear of, px. */
const EDGE = 8;

/**
 * Under its key, right edges flush, inside the window; over it where the key
 * sits nearer the bottom (the bar dragged to a bottom row). A key in a
 * standing `column` opens beside the column instead — level with the key,
 * towards the sheet: under it the window lay over the column's other keys
 * (toonop on a desk, 2026-10-10: the brush opened over the tools).
 */
export function plateAt(
  key: { left: number; right: number; top: number; bottom: number },
  plate: { w: number; h: number },
  view: { w: number; h: number },
  column?: { left: number; right: number },
): PlatePlace {
  if (column) {
    const after = column.right + GAP;
    const x = after + plate.w <= view.w - EDGE ? after : Math.max(EDGE, column.left - GAP - plate.w);
    const top = Math.max(EDGE, Math.min(key.top, view.h - EDGE - plate.h));
    return { x, top, max: view.h - top - 14 };
  }
  const above = key.top - 14;
  const below = view.h - key.bottom - 14;
  const x = Math.max(EDGE, Math.min(key.right - plate.w, view.w - plate.w - EDGE));
  return below >= above ? { x, top: key.bottom + GAP, max: below } : { x, bottom: view.h - key.top + GAP, max: above };
}
