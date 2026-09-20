/**
 * The "old" easter egg of the reference editor (DrawField.hx onOldEndDraw):
 * an oldschool pen whose committed stroke is not a line but a closed
 * contour of variable width — a capsule traced around the simplified
 * polyline, radius trunc(size/2) with a random wobble on gentle bends,
 * filled by the renderer (closed midpoint multicurve).
 *
 * Faithful port, quirks included (the backward pass reuses the last
 * jittered radius on sharp bends; caps are 5 points at π/4 steps). The one
 * intentional fix: a click without movement gives the 8-point circle the
 * reference clearly meant (its dot flag was never set, so it crashed).
 *
 * Geometry is pure and takes the RNG as a parameter, so it is testable.
 */

import { FIXED_POINT_SCALE, LANG_LOOK_AHEAD, STROKE_COORD_MAX, STROKE_COORD_MIN } from '../format/constants';
import { simplifyLang } from './simplify';

/** Lang tolerance the oldschool pen uses, in logical px (the normal pen uses 10). */
export const OLDSCHOOL_LANG_TOLERANCE_LOGICAL = 5;

const STEPS = 4; // points per half turn in the caps (π/4 apart)
const TAU = Math.PI * 2;

/** Random radius wobble amplitude (logical px) for a half width: half/2 clamped to 2..6, none below half 2. */
export function oldschoolJitter(halfWidth: number): number {
  if (halfWidth < 2) {
    return 0;
  }
  return Math.min(6, Math.max(2, halfWidth / 2));
}

/**
 * Closed contour around a polyline (flat [x0,y0,…]) at radius `half`, with
 * the radius jittered by random·jitter − jitter/2 on gentle bends. Output is
 * a flat closed polygon, to be filled as a closed midpoint multicurve.
 */
export function oldschoolContour(
  points: readonly number[],
  half: number,
  jitter: number,
  random: () => number,
): number[] {
  const out: number[] = [];
  const n = points.length / 2;
  const px = (i: number) => points[2 * i];
  const py = (i: number) => points[2 * i + 1];
  let rad = half;
  const push = (i: number, angle: number) => {
    out.push(px(i) + rad * Math.cos(angle), py(i) + rad * Math.sin(angle));
  };
  const wobble = () => {
    rad = half + random() * jitter - jitter / 2;
  };

  if (n === 1) {
    for (let a = 0; a < TAU; a += Math.PI / STEPS) {
      push(0, a);
    }
    return out;
  }

  // Start cap: half turn on the left of the first segment.
  let a0 = getAngle(px(0), py(0), px(1), py(1));
  for (let a = a0 + Math.PI / 2; a < a0 + Math.PI / 2 + Math.PI + Math.PI / STEPS / 2; a += Math.PI / STEPS) {
    push(0, a);
  }
  // Forward pass along one side.
  for (let k = 1; k < n - 1; k++) {
    const a1 = getAngle(px(k), py(k), px(k + 1), py(k + 1));
    a0 = sidePoint(k, a0, a1, push, wobble);
  }
  // End cap.
  a0 = getAngle(px(n - 2), py(n - 2), px(n - 1), py(n - 1));
  wobble();
  for (let a = a0 + Math.PI / 2 + Math.PI; a < a0 + Math.PI / 2 + TAU + Math.PI / STEPS / 2; a += Math.PI / STEPS) {
    push(n - 1, a);
  }
  // Backward pass along the other side.
  a0 = getAngle(px(n - 1), py(n - 1), px(n - 2), py(n - 2));
  for (let k = n - 2; k > 0; k--) {
    const a1 = getAngle(px(k), py(k), px(k - 1), py(k - 1));
    a0 = sidePoint(k, a0, a1, push, wobble);
  }
  return out;
}

/** One side point at vertex k between segment angles a0 → a1; returns a1 for the next step. */
function sidePoint(
  k: number,
  a0: number,
  a1: number,
  push: (i: number, angle: number) => void,
  wobble: () => void,
): number {
  let d = a0 - a1;
  let left: boolean;
  if (d > Math.PI) {
    d = TAU - d;
    left = false;
  } else if (d < -Math.PI) {
    d = TAU + d;
    left = true;
  } else if (d >= 0) {
    left = true;
  } else {
    d = -d;
    left = false;
  }
  let angle = midAngle(a0 - Math.PI / 2, a1 - Math.PI / 2);
  if (left) {
    angle += Math.PI;
  }
  // Sharp bend: keep the current radius; gentle bend: wobble it first.
  if (d <= Math.PI / 4) {
    wobble();
  }
  push(k, angle);
  return a1;
}

/** Segment direction in 0..2π (reference getAngle, with its atan quadrant fix-up). */
function getAngle(x1: number, y1: number, x2: number, y2: number): number {
  let a = y1 === y2 ? 0 : Math.atan((y2 - y1) / (x2 - x1));
  if (x2 - x1 < 0) {
    a += Math.PI;
  }
  while (a < 0) a += TAU;
  while (a > TAU) a -= TAU;
  return a;
}

/** Bisector of two angles, reference midAngle (normalized the same way). */
function midAngle(a: number, b: number): number {
  while (a < 0) a += TAU;
  while (a > TAU) a -= TAU;
  while (b < 0) b += TAU;
  while (b > TAU) b -= TAU;
  let c = TAU - a + b;
  while (c < 0) c += TAU;
  while (c > TAU) c -= TAU;
  c = a + c / 2;
  while (c < TAU) c += TAU;
  while (c > TAU) c -= TAU;
  return c;
}

/**
 * Commit of an oldschool gesture: raw points (float document units) →
 * Lang 5/5 logical px → contour at trunc(size/2) with the size's jitter →
 * integer int16 coordinates.
 */
export function commitOldschoolStroke(
  rawPoints: readonly number[],
  brushSizeLogical: number,
  random: () => number = Math.random,
  tolerance = OLDSCHOOL_LANG_TOLERANCE_LOGICAL * FIXED_POINT_SCALE,
): number[] {
  if (rawPoints.length < 2) {
    throw new Error('cannot commit an empty stroke');
  }
  const halfLogical = Math.trunc(brushSizeLogical / 2);
  const simplified = simplifyLang(rawPoints, LANG_LOOK_AHEAD, tolerance);
  const contour = oldschoolContour(
    simplified,
    halfLogical * FIXED_POINT_SCALE,
    oldschoolJitter(halfLogical) * FIXED_POINT_SCALE,
    random,
  );
  return contour.map((v) => {
    const q = Math.min(STROKE_COORD_MAX, Math.max(STROKE_COORD_MIN, Math.round(v)));
    return q === 0 ? 0 : q; // fold -0
  });
}
