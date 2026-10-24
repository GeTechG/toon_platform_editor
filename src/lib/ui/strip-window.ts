/**
 * Which frames the timeline strip builds, and what stands in for the rest.
 *
 * The format allows 4096 frames, and a row is built per layer: three hundred
 * frames on five layers is fifteen hundred buttons with a canvas inside, which
 * the browser lays out and keeps. The window of visibility already stops their
 * thumbnails from taking a graphics context; this stops the markup itself.
 *
 * The rest of the row is two spacers, sized so the scrollbar is the length it
 * would be with every cell in place and a frame stays where the hand left it.
 * A row is a flex line with a gap between neighbours, so the spacer before the
 * window is a gap short of the space the cells took — the gap after the spacer
 * makes it up.
 */

import { filmTiming, type FilmTiming } from '../model/timing';

export interface StripWindow {
  /** First frame built. */
  readonly first: number;
  /** How many frames are built. */
  readonly count: number;
  /** Width of the spacer before the window, 0 when there is none. */
  readonly before: number;
  /** Width of the spacer after the window, 0 when there is none. */
  readonly after: number;
}

/** A screen of margin either side, the same the thumbnails are drawn ahead by. */
const MARGIN_SCREENS = 1;

/**
 * `timing` places frames by their ticks: a frame held three ticks is three
 * cells wide (and the gaps between them), so the strip is laid out in time.
 */
export function stripWindow(
  total: number,
  cellWidth: number,
  gap: number,
  scrollLeft: number,
  viewWidth: number,
  timing: FilmTiming = filmTiming(undefined, total),
): StripWindow {
  const pitch = cellWidth + gap;
  const whole = (first: number, count: number): StripWindow => ({
    first,
    count,
    before: first > 0 ? timing.start(first) * pitch - gap : 0,
    after: first + count < total ? (timing.total - timing.start(first + count)) * pitch - gap : 0,
  });
  // Before the first layout the strip has no size of its own. Building it
  // whole for one frame beats showing an empty strip.
  if (total <= 0 || pitch <= 0 || viewWidth <= 0) {
    return whole(0, Math.max(0, total));
  }
  const margin = viewWidth * MARGIN_SCREENS;
  const first = timing.frameAt(Math.floor((scrollLeft - margin) / pitch));
  // The last frame that starts before the far edge of the margin: a frame
  // whose left edge is exactly on it is already past the window.
  const last = timing.frameAt(Math.ceil((scrollLeft + viewWidth + margin) / pitch) - 1);
  return whole(first, Math.max(0, last - first + 1));
}

/**
 * The frame whose cell is the strip's Tab stop. The stop is the active cell
 * (roving tabindex), but the scrollbar can carry the window away from it: the
 * active cell is not built, and the strip had no stop left. Then the stop is
 * the first frame fully in view, on the same layer.
 */
export function stripTabStop(
  active: number,
  total: number,
  cellWidth: number,
  gap: number,
  scrollLeft: number,
  viewWidth: number,
  timing: FilmTiming = filmTiming(undefined, total),
): number {
  const win = stripWindow(total, cellWidth, gap, scrollLeft, viewWidth, timing);
  // Before the first layout the window is the whole strip: out of it is only
  // a strip with no frames.
  if (total <= 0 || (active >= win.first && active < win.first + win.count)) {
    return active;
  }
  return timing.frameAt(Math.ceil(scrollLeft / (cellWidth + gap)));
}

/**
 * Where the strip has to scroll for `frame` to be in view, or null when it
 * already is. The frame's place is arithmetic: its node may not be built, so
 * there is nothing to ask `scrollIntoView`. `pad` is the row's own padding:
 * the frame sits that far in, and is shown with that much room either side,
 * or the last frame's ring ends under the edge.
 */
export function scrollToFrame(
  frame: number,
  cellWidth: number,
  gap: number,
  scrollLeft: number,
  viewWidth: number,
  pad = 0,
  timing?: FilmTiming,
): number | null {
  const pitch = cellWidth + gap;
  if (pitch <= 0 || viewWidth <= 0) {
    return null;
  }
  const at = timing ? timing.start(frame) : frame;
  const ticks = timing ? timing.start(frame + 1) - at : 1;
  const left = at * pitch;
  const right = left + ticks * pitch - gap + 2 * pad;
  if (left < scrollLeft) {
    return left;
  }
  if (right > scrollLeft + viewWidth) {
    return right - viewWidth;
  }
  return null;
}

/**
 * How much further the strip scrolls down than its rows reach: the wave's
 * lane under the last row, and the strip's own scrollbar, which the names
 * beside it do not have. The names scroll in step with the strip, and with
 * less to scroll they stopped short: at the strip's end the bottom names sat
 * off their cells by this much. `rowsEnd` is where the last row ends, in the
 * strip's content.
 */
export function stripTail(
  box: { scrollHeight: number; clientHeight: number; offsetHeight: number },
  rowsEnd: number,
): number {
  if (box.scrollHeight <= box.clientHeight) {
    return 0;
  }
  return Math.max(0, box.scrollHeight - rowsEnd) + box.offsetHeight - box.clientHeight;
}

/**
 * How far a wheel over the timeline moves the strip, in pixels (owner,
 * 2026-10-18: the wheel over the frames scrolls the frames, never the page).
 * A mouse has one wheel and the frames run sideways: with no rows to scroll
 * through (`rows` false), or with Shift, the plain wheel walks the frames.
 * `page` is what one page of a page-counted wheel is.
 */
export function wheelOnStrip(
  e: { deltaX: number; deltaY: number; deltaMode: number; shiftKey: boolean },
  rows: boolean,
  page: number,
): { x: number; y: number } {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? page : 1;
  const x = e.deltaX * unit;
  const y = e.deltaY * unit;
  return x === 0 && (!rows || e.shiftKey) ? { x: y, y: 0 } : { x, y };
}
