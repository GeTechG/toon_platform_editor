/**
 * The brush the editor draws with.
 *
 * It started from the line of toonio.ru and is ours now: the rules are written
 * out here in full and read nothing from the shipped parity plugin, the same
 * way the `toonop` UX profile is written out rather than copied from `toonio`.
 * A parity fix over there must not be able to move the line drawn here.
 */

import { FIXED_POINT_SCALE } from '../format/constants';
import { laySmoothPoints } from '../render/smoothing';
import type { PluginBrush } from '../plugins/contract';
import type { StrokeRules } from './profiles';

/** What the brush starts at, and how far its slider goes. */
const DEFAULTS = { width: 5, smooth: 3, minDistance: 3 } as const;
const RANGE = { min: 1, max: 500 } as const;

export function toonopRules({ smooth, minDistance }: PluginBrush): StrokeRules {
  return {
    range: RANGE,
    defaults: DEFAULTS,
    smoothing: true,
    capture: (_line, batch) => collect(batch),
    // Stage one is what the hand sees; the commit runs stage two on top of it.
    preview: (points) => thinBySmooth(points, smooth),
    prepare: (points, _width, zoom) => thinByDistance(thinBySmooth(points, smooth), minDistance, zoom),
    path: laySmoothPoints,
    // An interrupted gesture lands what it has rather than being thrown away.
    commitOnCancel: true,
  };
}

/**
 * One batch of pointer samples, rounded to the document unit they are stored
 * in — an eighth of a logical pixel. The reference truncates to whole pixels
 * because its canvas is that grid; this canvas is a sheet on a table, and at
 * zoom 4 the hand moves a quarter pixel at a time. A repeat inside the batch
 * is dropped; one across the seam of two events survives, because the dedup is
 * per batch and the batches are appended.
 */
function collect(batch: readonly number[]): number[] {
  const out: number[] = [];
  let previousX: number | undefined;
  let previousY: number | undefined;
  for (let i = 0; i + 1 < batch.length; i += 2) {
    const x = Math.round(batch[i]);
    const y = Math.round(batch[i + 1]);
    if (x === previousX && y === previousY) continue;
    out.push(x, y);
    previousX = x;
    previousY = y;
  }
  return out;
}

/**
 * Stage one: the first point, every `smooth`-th one and the last, written down
 * twice — the endpoint sentinel the curve needs to reach where the hand let go.
 */
function thinBySmooth(points: readonly number[], smooth: number): number[] {
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
 * Stage two: drop a point the hand barely moved from. The threshold is written
 * in the canvas's own pixels, so on a document of another size it is divided by
 * the canvas scale, the way the width is.
 */
function thinByDistance(
  points: readonly number[],
  minDistance: number,
  zoom: number,
): number[] {
  if (points.length <= 2) return points.slice();
  const result = [points[0], points[1]];
  const threshold =
    (clampInteger(minDistance, 0, 30) * FIXED_POINT_SCALE) / positive(zoom);
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
