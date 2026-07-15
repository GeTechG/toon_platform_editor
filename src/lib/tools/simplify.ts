/**
 * Polyline simplification with the Lang algorithm: lookAhead window,
 * perpendicular tolerance. Deterministic, preserves the first and last
 * points.
 *
 * Faithful port of the reference editor's implementation, quirks
 * included, so committed lines match it exactly:
 * - deviation is measured to the infinite line through the window
 *   chord (not the segment), so overshoots/hooks along the stroke
 *   direction are dropped;
 * - deviation equal to the tolerance already rejects (>=);
 * - the true endpoint replaces the last kept point rather than being
 *   appended.
 */

/**
 * @param points flat array [x0, y0, …]
 * @param lookAhead maximum window step (in points)
 * @param tolerance allowed perpendicular deviation of intermediate
 *   points from the chord line (in the same units as the coordinates)
 */
export function simplifyLang(
  points: readonly number[],
  lookAhead: number,
  tolerance: number,
): number[] {
  if (!Number.isInteger(lookAhead) || lookAhead < 1) {
    throw new RangeError(`lookAhead must be an integer ≥ 1, got ${lookAhead}`);
  }
  const count = points.length / 2;
  if (count < 3) {
    return points.slice() as number[];
  }
  const out: number[] = [points[0], points[1]];
  let window = lookAhead;
  let key = 0;
  while (key < count) {
    // Reference quirk kept as-is: the clamp compares against count, not
    // count-1, so a window that lands exactly one past the end returns 0
    // and that key is skipped entirely.
    if (key + window > count) {
      window = count - key - 1;
    }
    const step = toleranceBar(points, count, key, window, tolerance);
    if (step > 0 && key + step < count) {
      out.push(points[2 * (key + step)], points[2 * (key + step) + 1]);
      key += step - 1;
    }
    key++;
  }
  out[out.length - 2] = points[points.length - 2];
  out[out.length - 1] = points[points.length - 1];
  return out;
}

/**
 * Largest window ≤ `window` whose intermediate points all stay within
 * `tolerance` of the line through the window chord; 0 if none.
 */
function toleranceBar(
  points: readonly number[],
  count: number,
  key: number,
  window: number,
  tolerance: number,
): number {
  if (key + window >= count) {
    return 0;
  }
  const ax = points[2 * key];
  const ay = points[2 * key + 1];
  const vx = points[2 * (key + window)] - ax;
  const vy = points[2 * (key + window) + 1] - ay;
  for (let j = 1; j <= window; j++) {
    const wx = points[2 * (key + j)] - ax;
    const wy = points[2 * (key + j) + 1] - ay;
    let angle = Math.acos((vx * wx + vy * wy) / (Math.hypot(vx, vy) * Math.hypot(wx, wy)));
    if (Number.isNaN(angle)) {
      angle = 0;
    }
    if (Math.sin(angle) * Math.hypot(wx, wy) >= tolerance) {
      window--;
      if (window > 0) {
        return toleranceBar(points, count, key, window, tolerance);
      }
      return 0;
    }
  }
  return window;
}
