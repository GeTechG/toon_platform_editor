/**
 * Plane geometry for the transform tools: the affine matrix a selection is
 * dragged, turned and scaled by, the polygon hit test the lasso selects with,
 * and the bilinear warp the distort tool reprojects through.
 *
 * Pure math over document units, so `bun test` covers it and the tools and
 * Svelte components stay thin callers.
 */

import { STROKE_COORD_MAX, STROKE_COORD_MIN } from '../format/constants';

/** Affine transform `[a, b, c, d, e, f]`: x' = ax + cy + e, y' = bx + dy + f. */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];

export interface TransformParams {
  /** Translation in document units. */
  dx?: number;
  dy?: number;
  /** Rotation in degrees, clockwise on screen (y grows downwards). */
  rotate?: number;
  /** Scale per axis; a negative value mirrors about the centre. */
  scaleX?: number;
  scaleY?: number;
}

/**
 * Scale, then rotate — both about (cx, cy) — then translate. That is the
 * order the reference transform window applies its fields in, so typing a
 * rotation does not drag the selection sideways.
 */
export function transformMatrix(params: TransformParams, cx: number, cy: number): Matrix {
  const { dx = 0, dy = 0, rotate = 0, scaleX = 1, scaleY = 1 } = params;
  const radians = (rotate * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const a = cos * scaleX;
  const b = sin * scaleX;
  const c = -sin * scaleY;
  const d = cos * scaleY;
  return [a, b, c, d, cx + dx - a * cx - c * cy, cy + dy - b * cx - d * cy];
}

export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * Even-odd ray cast over a flat `[x0, y0, x1, y1, …]` polygon. Points exactly
 * on an edge fall either way; the lasso does not need a tie-break, because a
 * stroke is selected when *any* of its points is inside.
 */
export function pointInPolygon(x: number, y: number, polygon: readonly number[]): boolean {
  const count = polygon.length >> 1;
  if (count < 3) {
    return false;
  }
  let inside = false;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = polygon[i * 2];
    const yi = polygon[i * 2 + 1];
    const xj = polygon[j * 2];
    const yj = polygon[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Reprojects a point from `box` into `quad` — four corners in TL, TR, BR, BL
 * order — by bilinear interpolation. A corner dragged away takes the points
 * near it along and leaves the opposite corner untouched.
 */
export function bilinearWarp(
  x: number,
  y: number,
  box: Box,
  quad: readonly number[],
): [number, number] {
  const u = box.width === 0 ? 0 : (x - box.x) / box.width;
  const v = box.height === 0 ? 0 : (y - box.y) / box.height;
  const top = (1 - u) * (1 - v);
  const topRight = u * (1 - v);
  const bottomRight = u * v;
  const bottomLeft = (1 - u) * v;
  return [
    top * quad[0] + topRight * quad[2] + bottomRight * quad[4] + bottomLeft * quad[6],
    top * quad[1] + topRight * quad[3] + bottomRight * quad[5] + bottomLeft * quad[7],
  ];
}

/** Rounds to a whole document unit inside the int16 range the format stores. */
export function clampCoord(value: number): number {
  if (!Number.isFinite(value)) {
    return value === Number.POSITIVE_INFINITY
      ? STROKE_COORD_MAX
      : value === Number.NEGATIVE_INFINITY
        ? STROKE_COORD_MIN
        : 0;
  }
  return Math.min(STROKE_COORD_MAX, Math.max(STROKE_COORD_MIN, Math.round(value)));
}
