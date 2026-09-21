/**
 * The Tonio brush's own rules — everything the core used to know about the
 * Tonio canvas lives here instead: the canvas its numbers are measured on,
 * how the pointer's samples are collected, the two thinning stages, and how
 * the result is laid down for the shared reader.
 */

import { FIXED_POINT_SCALE } from '../lib/format/constants';
import type { StrokeRules } from '../lib/plugins/contract';

/** Native width of the source Tonio drawing canvas. */
export const TONIO_CANVAS_WIDTH = 1280;

/** The tuning the editor holds for this brush (reference `s` and `m`). */
export interface ToonioTuning {
  smooth: number;
  minDistance: number;
}

export function toonioRules({ smooth, minDistance }: ToonioTuning): StrokeRules {
  return {
    canvas: TONIO_CANVAS_WIDTH,
    // The reference's own slider and its starting numbers.
    range: { min: 1, max: 500 },
    defaults: { width: 5, smooth: 3, minDistance: 3 },
    smoothing: true,
    capture: (line, batch) => [...line, ...collect(batch)],
    // Stage one is what the hand sees; the commit runs stage two on top of it.
    preview: (points) => toonioSmooth(points, smooth),
    prepare: (points, _width, zoom, canvasScale) =>
      toonioPrepare(toonioSmooth(points, smooth), minDistance, zoom, canvasScale),
    path: layToonioPoints,
    // The reference commits what it has when a gesture is interrupted, rather
    // than throwing the line away.
    commitOnCancel: true,
  };
}

/**
 * One batch of pointer samples, truncated to whole logical pixels the way the
 * reference's `CreatePointData` does. A repeat inside the batch is dropped;
 * one across the seam of two events survives, because the reference dedups
 * per batch and then appends.
 */
function collect(batch: readonly number[]): number[] {
  const out: number[] = [];
  let previousX: number | undefined;
  let previousY: number | undefined;
  for (let i = 0; i + 1 < batch.length; i += 2) {
    const [x, y] = truncateToPixel(batch[i], batch[i + 1]);
    if (x === previousX && y === previousY) continue;
    out.push(x, y);
    previousX = x;
    previousY = y;
  }
  return out;
}

export function truncateToPixel(xDoc: number, yDoc: number): [number, number] {
  return [
    Math.trunc(xDoc / FIXED_POINT_SCALE) * FIXED_POINT_SCALE,
    Math.trunc(yDoc / FIXED_POINT_SCALE) * FIXED_POINT_SCALE,
  ];
}

/**
 * Stage one (reference `Tool.Smooth`): the first point, every `smooth`-th one
 * and the last, written down twice — the endpoint sentinel the curve needs to
 * reach where the hand let go.
 */
export function toonioSmooth(points: readonly number[], smooth: number): number[] {
  if (points.length === 0) return [];
  const result = [points[0], points[1]];
  const step = clampInteger(smooth, 1, 100) * 2;
  for (let i = 2; i < points.length - 2; i += step) result.push(points[i], points[i + 1]);
  const x = points[points.length - 2];
  const y = points[points.length - 1];
  result.push(x, y, x, y);
  return result;
}

/**
 * Stage two (reference `Tool.Prepare`): drop a point the hand barely moved
 * from. The threshold is written in the reference's own pixels, so on a
 * document of another size it is divided by the canvas scale, the way the
 * width is.
 */
export function toonioPrepare(
  points: readonly number[],
  minDistance: number,
  zoom: number,
  canvasScale = 1,
): number[] {
  if (points.length <= 2) return points.slice();
  const result = [points[0], points[1]];
  const threshold =
    (clampInteger(minDistance, 0, 30) * FIXED_POINT_SCALE) / (zoom * positive(canvasScale));
  for (let i = 2; i < points.length - 2; i += 2) {
    const distance = Math.hypot(points[i - 2] - points[i], points[i - 1] - points[i + 1]);
    if (distance > threshold) result.push(points[i], points[i + 1]);
  }
  const x = points[points.length - 2];
  const y = points[points.length - 1];
  result.push(x, y, x, y);
  return result;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * Lays collected points down for the `smooth` reader.
 *
 * Tonio's own emitter ran one quadratic per point with the *previous* point as
 * the control, so its curve started half a segment behind the shared reader,
 * which takes the stored point as the control. Repeating the first point shifts
 * the phase back and the two draw the same line — see the parity test.
 */
export function layToonioPoints(points: readonly number[]): number[] {
  if (points.length < 2) {
    return points.slice();
  }
  return [points[0], points[1], ...points];
}
