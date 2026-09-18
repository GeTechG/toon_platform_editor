/**
 * Tonio's mega eraser (tools.js `MegaEraser.Erase`): the gesture is a capsule
 * of radius `width / 2` swept along its polyline, and every stored stroke it
 * touches is cut into the pieces that survive. The pieces keep the descriptor
 * of the stroke they came from; a stroke swallowed whole disappears.
 *
 * Unlike the reference this is an operation over a cell's stroke list, not a
 * stroke of its own: nothing is added to the document, so it goes through the
 * ordinary undo stack instead of being unrecoverable.
 */

export interface ErasableStroke {
  points: number[];
  tool_id: number;
}

/** Squared distance from (px,py) to the segment (ax,ay)-(bx,by). */
function segmentDistanceSq(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const lengthSq = vx * vx + vy * vy;
  const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * vx + (py - ay) * vy) / lengthSq));
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return dx * dx + dy * dy;
}

/** Whether a point lies inside the capsule swept along the gesture. */
function inside(x: number, y: number, gesture: readonly number[], radius: number): boolean {
  const radiusSq = radius * radius;
  if (gesture.length === 2) {
    return segmentDistanceSq(x, y, gesture[0], gesture[1], gesture[0], gesture[1]) <= radiusSq;
  }
  for (let i = 2; i < gesture.length; i += 2) {
    if (segmentDistanceSq(x, y, gesture[i - 2], gesture[i - 1], gesture[i], gesture[i + 1]) <= radiusSq) {
      return true;
    }
  }
  return false;
}

/**
 * Parameter on [lo, hi] where the segment crosses the capsule boundary.
 *
 * ponytail: bisection, not an analytic capsule intersection — the boundary of
 * a swept union has no closed form worth writing here, and 20 halvings land
 * well inside one document unit. Swap in an analytic solution only if a
 * profile ever blames this.
 */
function crossing(
  x0: number, y0: number, x1: number, y1: number,
  lo: number, hi: number,
  gesture: readonly number[], radius: number,
): [number, number] {
  const insideLo = inside(x0 + (x1 - x0) * lo, y0 + (y1 - y0) * lo, gesture, radius);
  for (let step = 0; step < 20; step++) {
    const mid = (lo + hi) / 2;
    if (inside(x0 + (x1 - x0) * mid, y0 + (y1 - y0) * mid, gesture, radius) === insideLo) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const t = (lo + hi) / 2;
  return [Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t)];
}

/**
 * Cuts one stroke, returning the surviving pieces in order. Segments are
 * sampled at half the radius before each crossing is refined, so a capsule
 * the stroke only dips into is still found.
 */
function eraseStroke(stroke: ErasableStroke, gesture: readonly number[], radius: number): ErasableStroke[] {
  const { points } = stroke;
  const pieces: ErasableStroke[] = [];
  let current: number[] = [];
  const flush = (): void => {
    if (current.length >= 2) {
      pieces.push({ points: current, tool_id: stroke.tool_id });
    }
    current = [];
  };

  let previousInside = inside(points[0], points[1], gesture, radius);
  if (!previousInside) {
    current.push(points[0], points[1]);
  }
  for (let i = 2; i < points.length; i += 2) {
    const x0 = points[i - 2];
    const y0 = points[i - 1];
    const x1 = points[i];
    const y1 = points[i + 1];
    const length = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil((length / Math.max(radius, 1)) * 2));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const nowInside = inside(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, gesture, radius);
      if (nowInside !== previousInside) {
        const [cx, cy] = crossing(x0, y0, x1, y1, (s - 1) / steps, t, gesture, radius);
        if (previousInside) {
          current.push(cx, cy);
        } else {
          current.push(cx, cy);
          flush();
        }
        previousInside = nowInside;
      }
    }
    if (!previousInside) {
      current.push(x1, y1);
    }
  }
  flush();
  return pieces;
}

/**
 * Applies the eraser to a cell's stroke list. Returns the same array contents
 * when nothing was touched, so a gesture over empty space is a no-op the
 * caller can skip recording.
 */
export function eraseStrokes(
  strokes: readonly ErasableStroke[],
  gesture: readonly number[],
  radius: number,
): ErasableStroke[] {
  if (gesture.length < 2 || radius <= 0) {
    return strokes.map((stroke) => ({ points: stroke.points.slice(), tool_id: stroke.tool_id }));
  }
  const result: ErasableStroke[] = [];
  for (const stroke of strokes) {
    if (stroke.points.length < 2) {
      continue;
    }
    result.push(...eraseStroke(stroke, gesture, radius));
  }
  return result;
}
