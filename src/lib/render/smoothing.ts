/**
 * The path readers of the format: the stored numbers plus the way to read
 * them. Nothing here names a brush, an editor or a reference application —
 * a document says how its points are shaped, and the player draws it with
 * this same code.
 *
 * Deterministic over quantized points.
 */

/** Minimal path-command sink (subset of CanvasRenderingContext2D). */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void;
}

/**
 * The `smooth` chain: quadratic Béziers through midpoints — the control point
 * is the stored point, the segment end is the midpoint towards the next one.
 * The final segment curves straight into the last point. Coordinates are
 * passed through as-is; scaling is the caller's transform.
 */
function emitSmoothPath(points: readonly number[], sink: PathSink): void {
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
 * The closed variant, for a `kind` that fills a ring: starts at the midpoint
 * of the first segment, one quadratic per point with the next midpoint as the
 * end, and a final quadratic through the first point back to the start. Two
 * points degrade to a line.
 */
function emitSmoothClosedPath(points: readonly number[], sink: PathSink): void {
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

/** How a stroke's stored numbers are read into a path. */
export type StrokeGeometry = 'line' | 'smooth' | 'cubic';

/**
 * The only path reader the core has: the stored numbers plus the way to read
 * them. No brush, editor or reference application is named here — a document
 * says how its points are shaped, and the player draws it with this.
 */
export function emitGeometry(
  points: readonly number[],
  geometry: StrokeGeometry,
  closed: boolean,
  sink: PathSink,
): void {
  if (geometry === 'line') {
    if (points.length < 2) {
      return;
    }
    sink.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) {
      sink.lineTo(points[i], points[i + 1]);
    }
    return;
  }
  if (geometry === 'smooth') {
    if (closed) {
      emitSmoothClosedPath(points, sink);
    } else {
      emitSmoothPath(points, sink);
    }
    return;
  }
  if (points.length < 2) {
    return;
  }
  sink.moveTo(points[0], points[1]);
  for (let i = 2; i + 5 < points.length; i += 6) {
    sink.bezierCurveTo(
      points[i],
      points[i + 1],
      points[i + 2],
      points[i + 3],
      points[i + 4],
      points[i + 5],
    );
  }
}
