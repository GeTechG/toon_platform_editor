/**
 * Plane geometry for the transform tools: the affine matrix a selection is
 * dragged, turned and scaled by, and the box it is measured in.
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

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Truncates to a whole document unit inside the int16 range the format
 * stores. The reference truncates towards zero everywhere it writes a
 * coordinate (`tools.js:1808-1873`), and so do we when a stroke is captured.
 */
export function clampCoord(value: number): number {
  if (!Number.isFinite(value)) {
    return value === Number.POSITIVE_INFINITY
      ? STROKE_COORD_MAX
      : value === Number.NEGATIVE_INFINITY
        ? STROKE_COORD_MIN
        : 0;
  }
  return Math.min(STROKE_COORD_MAX, Math.max(STROKE_COORD_MIN, Math.trunc(value)));
}
