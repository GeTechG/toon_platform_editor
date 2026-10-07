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

/**
 * The floor of a cell's thumbnail box: with the 1px border a side the cell's
 * button is 24 px, the Dense-Timeline floor (WCAG 2.2 AA 2.5.8).
 */
const CELL_FLOOR = 22;

/**
 * The box a timeline cell gives its thumbnail: the canvas fitted into the
 * frame, and never under the floor. A panorama sheet (1280×320) made cells
 * 14 px tall and a 20:1 one 4 px — a frame nobody could press. The drawing
 * keeps its proportions inside (`fitThumb`); the cell centres it.
 */
export function cellSize(width: number, height: number): { w: number; h: number } {
  const fit = fitThumb(width, height, CELL_BOX.w, CELL_BOX.h);
  return { w: Math.max(CELL_FLOOR, fit.w), h: Math.max(CELL_FLOOR, fit.h) };
}

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

/**
 * The row as CSS: the frame's height, and never under the row's keys, which
 * are in rem and grow with the text — at 150 % the eye was 42 px in a 32 px
 * row and reached into its neighbours. The layer list and the strip both
 * take this, so a name stays level with its cells at any text size.
 */
export function rowHeightCss(doc: { width: number; height: number }): string {
  return `max(${rowHeight(doc)}px, calc(1.75rem + 4px))`;
}

/**
 * What a cell thumbnail was drawn from, as one number. H, a lasso move and a
 * transform rewrite the points in place — the same cell with the same count —
 * so identity and count alone left the timeline showing the old drawing. One
 * pass over the points, the same order of work as drawing them, and only for
 * cells on screen.
 */
export function cellStamp(cell: { strokes: readonly { points: readonly number[]; tool_id: number }[] }): number {
  let h = cell.strokes.length;
  for (const stroke of cell.strokes) {
    h = (Math.imul(h, 31) + stroke.tool_id) | 0;
    h = (Math.imul(h, 31) + stroke.points.length) | 0;
    for (const v of stroke.points) {
      h = (Math.imul(h, 31) + v) | 0;
    }
  }
  return h;
}

/** The layer row the bottom bar's floor is written for, px (presets.ts, `PANEL_HEIGHT_MIN`). */
const FLOOR_ROW = 44;

/**
 * What a sheet's layer row stands over that one: an upright sheet's frame is
 * 46 px and its row 52, and at the floor the bar cut the frame's foot off
 * (owner, 2026-10-07).
 */
export function rowOver(doc: { width: number; height: number }): number {
  return Math.max(0, rowHeight(doc) - FLOOR_ROW);
}

