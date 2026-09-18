/**
 * Lasso selection and the transform session it opens (toonio.bundle.js
 * `Lasso`): a polygon picks strokes out of a cell, their bounding box gets
 * the handles, and every drag, field and hotkey accumulates into one set of
 * parameters. Nothing is written to the document until the session is
 * applied, so Esc is free and Enter is a single undo step.
 *
 * Pure data and pure functions — the Svelte components only hold the session
 * and draw it.
 */

import type { Box, Matrix } from '../model/geom';
import { pointInPolygon, transformMatrix } from '../model/geom';

export interface SelectableStroke {
  points: readonly number[];
}

/** What the transform window edits: one accumulated transform of the selection. */
export interface TransformSession {
  dx: number;
  dy: number;
  /** Degrees, clockwise on screen. */
  rotate: number;
  scaleX: number;
  scaleY: number;
}

export const EMPTY_TRANSFORM: TransformSession = { dx: 0, dy: 0, rotate: 0, scaleX: 1, scaleY: 1 };

/** Reference nudge steps: arrows 1 (shift 10), Q/W 1° (shift 15°), +/- 10%. */
const MOVE_STEP = 1;
const MOVE_STEP_SHIFT = 10;
const ROTATE_STEP = 1;
const ROTATE_STEP_SHIFT = 15;
const SCALE_STEP = 0.1;
/** A selection scaled to nothing can never be grown back, so it never gets there. */
const SCALE_MIN = 0.01;

/**
 * Indices of the strokes with at least one point inside the polygon — the
 * reference's rule, and the forgiving one: a stroke clipped by the lasso
 * comes along whole rather than being cut.
 */
export function selectStrokes(
  strokes: readonly SelectableStroke[],
  polygon: readonly number[],
): number[] {
  const selected: number[] = [];
  if (polygon.length < 6) {
    return selected;
  }
  strokes.forEach((stroke, index) => {
    for (let i = 0; i < stroke.points.length; i += 2) {
      if (pointInPolygon(stroke.points[i], stroke.points[i + 1], polygon)) {
        selected.push(index);
        return;
      }
    }
  });
  return selected;
}

/** Axis-aligned box around the chosen strokes; null when nothing is chosen. */
export function selectionBounds(
  strokes: readonly SelectableStroke[],
  indices: readonly number[],
): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const index of indices) {
    const stroke = strokes[index];
    if (!stroke) {
      continue;
    }
    for (let i = 0; i < stroke.points.length; i += 2) {
      minX = Math.min(minX, stroke.points[i]);
      maxX = Math.max(maxX, stroke.points[i]);
      minY = Math.min(minY, stroke.points[i + 1]);
      maxY = Math.max(maxY, stroke.points[i + 1]);
    }
  }
  if (minX === Infinity) {
    return null;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The session as an affine transform about the centre of the selection box. */
export function sessionMatrix(session: TransformSession, box: Box): Matrix {
  return transformMatrix(session, box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * Factor the stroke width is multiplied by when "change width with scale" is
 * on: the mean of the axis scales, unsigned — a mirror does not thin a line.
 */
export function sessionWidthScale(session: TransformSession): number {
  return (Math.abs(session.scaleX) + Math.abs(session.scaleY)) / 2;
}

/** One keyboard step: arrows move, Q/W rotate, +/- scale both axes. */
export function nudged(
  session: TransformSession,
  what: 'move' | 'rotate' | 'scale',
  dir: 1 | -1,
  shift: boolean,
  axis: 'x' | 'y' = 'x',
): TransformSession {
  switch (what) {
    case 'move': {
      const step = dir * (shift ? MOVE_STEP_SHIFT : MOVE_STEP);
      return axis === 'x' ? { ...session, dx: session.dx + step } : { ...session, dy: session.dy + step };
    }
    case 'rotate':
      return { ...session, rotate: session.rotate + dir * (shift ? ROTATE_STEP_SHIFT : ROTATE_STEP) };
    case 'scale': {
      const step = dir * SCALE_STEP;
      return {
        ...session,
        scaleX: stepScale(session.scaleX, step),
        scaleY: stepScale(session.scaleY, step),
      };
    }
  }
}

/** Grows or shrinks one axis, keeping its mirror sign and staying positive-sized. */
function stepScale(value: number, step: number): number {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.max(SCALE_MIN, Math.abs(value) + step);
}

/**
 * The selection box as a quad — corners clockwise from the top left. Both the
 * transform handles and the distort tool start from these four points; the
 * distort session is just this array with corners dragged out of place, fed
 * to `distortStrokes`.
 */
export function boxCorners(box: Box): number[] {
  return [
    box.x, box.y,
    box.x + box.width, box.y,
    box.x + box.width, box.y + box.height,
    box.x, box.y + box.height,
  ];
}

/** Index of the corner under (x, y) within `radius`, nearest first; null if none. */
export function cornerAt(
  quad: readonly number[],
  x: number,
  y: number,
  radius: number,
): number | null {
  let best: number | null = null;
  let bestDistance = radius * radius;
  for (let i = 0; i < quad.length; i += 2) {
    const dx = quad[i] - x;
    const dy = quad[i + 1] - y;
    const distance = dx * dx + dy * dy;
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = i / 2;
    }
  }
  return best;
}

/** The quad with one corner moved — a copy, so the original survives Esc. */
export function movedCorner(
  quad: readonly number[],
  corner: number,
  x: number,
  y: number,
): number[] {
  const next = quad.slice();
  next[corner * 2] = x;
  next[corner * 2 + 1] = y;
  return next;
}
