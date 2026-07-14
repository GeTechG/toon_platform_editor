/**
 * Polyline simplification with the Lang algorithm: lookAhead window,
 * perpendicular tolerance. Deterministic, preserves the first and last
 * points.
 */

/**
 * @param points flat array [x0, y0, …]
 * @param lookAhead maximum window step (in points)
 * @param tolerance allowed perpendicular deviation of intermediate
 *   points from the chord (in the same units as the coordinates)
 */
export function simplifyLang(
  points: readonly number[],
  lookAhead: number,
  tolerance: number,
): number[] {
  const count = points.length / 2;
  if (count <= 2) {
    return points.slice() as number[];
  }
  const out: number[] = [points[0], points[1]];
  let key = 0;
  while (key < count - 1) {
    let end = Math.min(key + lookAhead, count - 1);
    while (end > key + 1 && !chordWithinTolerance(points, key, end, tolerance)) {
      end--;
    }
    out.push(points[2 * end], points[2 * end + 1]);
    key = end;
  }
  return out;
}

function chordWithinTolerance(
  points: readonly number[],
  key: number,
  end: number,
  tolerance: number,
): boolean {
  for (let i = key + 1; i < end; i++) {
    const d = distanceToSegment(
      points[2 * i],
      points[2 * i + 1],
      points[2 * key],
      points[2 * key + 1],
      points[2 * end],
      points[2 * end + 1],
    );
    if (d > tolerance) {
      return false;
    }
  }
  return true;
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = 0;
  if (lengthSq > 0) {
    t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));
  }
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
