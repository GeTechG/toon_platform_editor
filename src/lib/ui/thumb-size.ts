/**
 * Thumbnail box for a document: the canvas max-fitted into the frame, its own
 * proportions kept. The frame's caps are the same for every project, so a
 * 16:9 board and a portrait one both fill their slot as far as they can
 * without pushing the timeline's columns around.
 */
export function fitThumb(
  width: number,
  height: number,
  maxW: number,
  maxH: number = maxW,
): { w: number; h: number } {
  const scale = Math.min(maxW / width, maxH / height);
  return {
    w: Math.max(1, Math.round(width * scale)),
    h: Math.max(1, Math.round(height * scale)),
  };
}

/** The timeline's frame: the cap a cell thumbnail fits into. */
export const CELL_BOX = { w: 46, h: 46 };

/** Cell border (1px a side) plus the strip's 2px padding above and below. */
const CELL_CHROME = 6;

/** The floor a layer row needs: its 28px icon buttons plus 2px of air a side. */
const ROW_FLOOR = 32;

/**
 * Row height: tall enough for the frame the canvas asks for, never shorter
 * than the name and the icons need.
 */
export function rowHeight(doc: { width: number; height: number }): number {
  return Math.max(ROW_FLOOR, fitThumb(doc.width, doc.height, CELL_BOX.w, CELL_BOX.h).h + CELL_CHROME);
}
