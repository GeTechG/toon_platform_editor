/**
 * Stroke smoothing: quadratic Béziers through midpoints — the control
 * point is the stored point, the segment end is the midpoint towards
 * the next one. The final segment curves straight into the last point
 * (control = second-to-last point), matching the reference editor.
 * Deterministic over quantized points.
 */

/** Minimal path-command sink (subset of CanvasRenderingContext2D). */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
}

/**
 * Emits a smoothed path for a flat [x0, y0, x1, y1, …] array.
 * Coordinates are passed through as-is — scaling is the caller's
 * transform.
 */
export function emitMultatorPath(points: readonly number[], sink: PathSink): void {
  const count = points.length / 2;
  if (count === 0) {
    return;
  }
  sink.moveTo(points[0], points[1]);
  if (count === 1) {
    return;
  }
  if (count === 2) {
    sink.lineTo(points[2], points[3]);
    return;
  }
  for (let i = 1; i < count - 2; i++) {
    const cx = points[2 * i];
    const cy = points[2 * i + 1];
    const nx = points[2 * (i + 1)];
    const ny = points[2 * (i + 1) + 1];
    sink.quadraticCurveTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
  }
  sink.quadraticCurveTo(
    points[2 * (count - 2)],
    points[2 * (count - 2) + 1],
    points[2 * (count - 1)],
    points[2 * (count - 1) + 1],
  );
}

/**
 * Closed variant (reference `multicurve(..., true)`, used for the oldschool
 * contour): starts at the midpoint of the first segment, one quadratic per
 * point with the next midpoint as the end, and a final quadratic through the
 * first point back to the start. Two points degrade to a line.
 */
export function emitMultatorClosedPath(points: readonly number[], sink: PathSink): void {
  const count = points.length / 2;
  if (count === 0) {
    return;
  }
  if (count === 1) {
    sink.moveTo(points[0], points[1]);
    return;
  }
  if (count === 2) {
    sink.moveTo(points[0], points[1]);
    sink.lineTo(points[2], points[3]);
    return;
  }
  const mid = (i: number, j: number): [number, number] => [
    (points[2 * i] + points[2 * j]) / 2,
    (points[2 * i + 1] + points[2 * j + 1]) / 2,
  ];
  const start = mid(0, 1);
  sink.moveTo(start[0], start[1]);
  for (let i = 1; i < count; i++) {
    const [mx, my] = mid(i, (i + 1) % count);
    sink.quadraticCurveTo(points[2 * i], points[2 * i + 1], mx, my);
  }
  sink.quadraticCurveTo(points[0], points[1], start[0], start[1]);
}

/** Backward-compatible name while renderer consumers migrate to dialect dispatch. */
export const emitSmoothedPath = emitMultatorPath;

/** Exact Tonio midpoint emitter; committed Tonio lines include their endpoint sentinel. */
export function emitTonioPath(points: readonly number[], sink: PathSink): void {
  for (let i = 2; i < points.length; i += 2) {
    const x = points[i];
    const y = points[i + 1];
    let previousX = points[i - 2];
    let previousY = points[i - 1];
    if (previousX === x && previousY === y) {
      previousX += 0.01;
      previousY += 0.01;
    }
    sink.quadraticCurveTo(previousX, previousY, (x + previousX) / 2, (y + previousY) / 2);
  }
  if (points.length === 2) {
    sink.quadraticCurveTo(points[0], points[1], points[0] + 0.01, points[1] + 0.01);
  }
}
