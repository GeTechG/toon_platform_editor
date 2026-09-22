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

export function stripWindow(
  total: number,
  cellWidth: number,
  gap: number,
  scrollLeft: number,
  viewWidth: number,
): StripWindow {
  const pitch = cellWidth + gap;
  const whole = (first: number, count: number): StripWindow => ({
    first,
    count,
    before: first > 0 ? first * pitch - gap : 0,
    after: first + count < total ? (total - first - count) * pitch - gap : 0,
  });
  // Before the first layout the strip has no size of its own. Building it
  // whole for one frame beats showing an empty strip.
  if (total <= 0 || pitch <= 0 || viewWidth <= 0) {
    return whole(0, Math.max(0, total));
  }
  const margin = viewWidth * MARGIN_SCREENS;
  const first = Math.max(0, Math.floor((scrollLeft - margin) / pitch));
  // The last frame that starts before the far edge of the margin: a frame
  // whose left edge is exactly on it is already past the window.
  const last = Math.min(total - 1, Math.ceil((scrollLeft + viewWidth + margin) / pitch) - 1);
  return whole(first, Math.max(0, last - first + 1));
}

/**
 * Where the strip has to scroll for `frame` to be in view, or null when it
 * already is. The frame's place is arithmetic: its node may not be built, so
 * there is nothing to ask `scrollIntoView`.
 */
export function scrollToFrame(
  frame: number,
  cellWidth: number,
  gap: number,
  scrollLeft: number,
  viewWidth: number,
): number | null {
  const pitch = cellWidth + gap;
  if (pitch <= 0 || viewWidth <= 0) {
    return null;
  }
  const left = frame * pitch;
  const right = left + cellWidth;
  if (left < scrollLeft) {
    return left;
  }
  if (right > scrollLeft + viewWidth) {
    return right - viewWidth;
  }
  return null;
}
