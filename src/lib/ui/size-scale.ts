/**
 * The thickness track on a logarithmic scale: linear, the everyday sizes
 * (1–20 of 500) were the first few pixels of the track and the rest of it
 * went to widths nobody draws with. The track is positions 0..SIZE_TRACK;
 * the size stays whole, as the brush keeps it.
 */
export const SIZE_TRACK = 1000;

/** The whole size at a track position, between `min` and `max`. */
export function sizeAtPosition(position: number, min: number, max: number): number {
  if (max <= min) {
    return min;
  }
  const t = Math.min(1, Math.max(0, position / SIZE_TRACK));
  return Math.min(max, Math.max(min, Math.round(min * (max / min) ** t)));
}

/** Where a size sits on the track: the inverse of `sizeAtPosition`. */
export function positionOfSize(size: number, min: number, max: number): number {
  if (max <= min) {
    return 0;
  }
  const clamped = Math.min(max, Math.max(min, size));
  // Unrounded: the track steps by `any`, and a whole position lost two sizes
  // a step at the far end.
  return (SIZE_TRACK * Math.log(clamped / min)) / Math.log(max / min);
}

/**
 * Track positions one screen pixel of the canvas drag is worth: the whole
 * scale in about 330 px, a thin brush a pixel for every six.
 */
const DRAG_POSITIONS_PER_PX = 3;

/**
 * The size a Shift+drag on the canvas reaches (Krita): right or up thickens,
 * left or down thins, along the slider's own logarithmic track.
 */
export function sizeFromDrag(start: number, dx: number, dy: number, min: number, max: number): number {
  return sizeAtPosition(positionOfSize(start, min, max) + (dx - dy) * DRAG_POSITIONS_PER_PX, min, max);
}
