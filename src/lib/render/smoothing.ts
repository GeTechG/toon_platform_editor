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
export function emitSmoothedPath(points: readonly number[], sink: PathSink): void {
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
