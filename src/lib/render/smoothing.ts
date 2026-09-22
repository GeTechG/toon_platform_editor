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

/**
 * Lays collected points down for the `smooth` reader.
 *
 * The reader takes a stored point as the control of its quadratic; an emitter
 * that used the *previous* point as the control started half a segment behind
 * it. Repeating the first point shifts the phase back, so both draw the same
 * line. It is a property of this reader, not of any one brush: the editor's
 * own brush and the importer of foreign files both lay points down this way.
 */
export function laySmoothPoints(points: readonly number[]): number[] {
  if (points.length < 2) {
    return points.slice();
  }
  return [points[0], points[1], ...points];
}

/**
 * The same path `emitGeometry` draws, from command `from` on.
 *
 * A live stroke grows at one end and is redrawn from nothing on every frame,
 * which costs the whole line over and over — the longer it is drawn, the
 * further the line lags behind the hand. What is already on the buffer does
 * not need drawing again; only the commands after the join do. The sub-path
 * starts exactly where the whole path had got to, so the join is a
 * continuation and not a step.
 *
 * `until` is the last command drawn, so a caller can take the settled
 * middle of the path and leave the end, which is still moving under the hand,
 * to be drawn somewhere it can be redrawn from scratch.
 *
 * Returns false when the path cannot be joined — a closed ring, a cubic
 * chain, a join past the end — and the caller draws it whole.
 */
export function emitGeometryFrom(
  points: readonly number[],
  geometry: StrokeGeometry,
  from: number,
  sink: PathSink,
  until = Infinity,
): boolean {
  const count = points.length / 2;
  if (from <= 0 && until >= count) {
    emitGeometry(points, geometry, false, sink);
    return true;
  }
  const start = Math.max(0, from);
  if (geometry === 'line') {
    // Command `i` is the segment onto point `i`; the join sits on it.
    if (start >= count) {
      return false;
    }
    sink.moveTo(points[2 * start], points[2 * start + 1]);
    for (let i = start + 1; i < Math.min(count, until + 1); i++) {
      sink.lineTo(points[2 * i], points[2 * i + 1]);
    }
    return true;
  }
  if (geometry !== 'smooth' || count < 3) {
    return false;
  }
  // `emitSmoothPath` lays down one command per point from the second on, and
  // command `i` ends on the midpoint towards point `i + 1` — except the last,
  // which ends on the last point itself.
  const last = count - 2;
  if (start > last) {
    return false;
  }
  if (start === last) {
    sink.moveTo(points[2 * (count - 1)], points[2 * (count - 1) + 1]);
    return true;
  }
  if (start === 0) {
    sink.moveTo(points[0], points[1]);
  } else {
    sink.moveTo(
      (points[2 * start] + points[2 * (start + 1)]) / 2,
      (points[2 * start + 1] + points[2 * (start + 1) + 1]) / 2,
    );
  }
  const stop = Math.min(last, until);
  for (let i = start + 1; i <= Math.min(last - 1, stop); i++) {
    const cx = points[2 * i];
    const cy = points[2 * i + 1];
    const nx = points[2 * (i + 1)];
    const ny = points[2 * (i + 1) + 1];
    sink.quadraticCurveTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
  }
  if (stop >= last) {
    sink.quadraticCurveTo(
      points[2 * last],
      points[2 * last + 1],
      points[2 * (count - 1)],
      points[2 * (count - 1) + 1],
    );
  }
  return true;
}
