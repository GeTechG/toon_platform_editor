/**
 * The magnet: lines under its circle are dragged along with the cursor
 * (owner, 2026-11-11 — «тащит за курсором», not pulled into the centre). A
 * point at distance `d` from where the cursor was moves by the cursor's step
 * times the strength times `(1 - (d/R)²)²`: whole under the middle, nothing
 * at the rim, smooth in between, so a line bends instead of breaking.
 *
 * Pure: the editor snapshots the cells, calls this on every move and writes
 * what comes back, the whole drag being one step of undo.
 */

import { MAX_STROKE_COORDS } from '../format/constants';
import type { Stroke, ToolDescriptor } from '../format/types';
import { quantizeStrokePoints } from '../model/operations';

export interface MagnetPull {
  /** Where the cursor was, document units. */
  readonly from: readonly [number, number];
  /** Where it is now. */
  readonly to: readonly [number, number];
  /** Radius of influence, document units. */
  readonly radius: number;
  /** Strength of influence, 0–1. */
  readonly strength: number;
  /**
   * Split long segments under the circle first, so a straight line of two
   * points bends. Only for smooth lines: a pixel stroke's points are marks,
   * and a cubic one's count is fixed by its segments.
   */
  readonly densify: boolean;
}

export interface MagnetResult {
  points: number[];
  pressure?: number[];
  /** Whether any point moved at all: a drag past every line is no step of undo. */
  moved: boolean;
}

/** How much of the step a point at squared distance `d2` gets. */
function weight(d2: number, r2: number): number {
  if (d2 >= r2) return 0;
  const k = 1 - d2 / r2;
  return k * k;
}

/** Squared distance from (px, py) to the segment (ax, ay)–(bx, by). */
function segmentDistance2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * vx + (py - ay) * vy) / len2));
  return (ax + t * vx - px) ** 2 + (ay + t * vy - py) ** 2;
}

/**
 * Every segment that touches the circle and is longer than a quarter of the
 * radius gets evenly spaced points put in; their pressure is read between
 * the segment's ends.
 */
function densify(
  points: readonly number[],
  pressure: readonly number[] | undefined,
  cx: number,
  cy: number,
  radius: number,
): { points: number[]; pressure?: number[] } {
  const step = radius / 4;
  const r2 = radius * radius;
  const out = points.length >= 2 ? [points[0], points[1]] : [];
  const press = pressure && pressure.length === points.length / 2 ? [pressure[0]] : undefined;
  for (let i = 2; i + 1 < points.length; i += 2) {
    const ax = points[i - 2];
    const ay = points[i - 1];
    const bx = points[i];
    const by = points[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (len > step && segmentDistance2(cx, cy, ax, ay, bx, by) < r2) {
      const pieces = Math.ceil(len / step);
      for (let k = 1; k < pieces; k++) {
        const t = k / pieces;
        out.push(ax + (bx - ax) * t, ay + (by - ay) * t);
        if (press && pressure) {
          press.push(Math.round(pressure[i / 2 - 1] + (pressure[i / 2] - pressure[i / 2 - 1]) * t));
        }
      }
    }
    out.push(bx, by);
    if (press && pressure) press.push(pressure[i / 2]);
  }
  return { points: out, pressure: press ?? pressure?.slice() };
}

export function magnetStroke(
  points: readonly number[],
  pressure: readonly number[] | undefined,
  pull: MagnetPull,
): MagnetResult {
  const [cx, cy] = pull.from;
  const dx = (pull.to[0] - cx) * pull.strength;
  const dy = (pull.to[1] - cy) * pull.strength;
  const r2 = pull.radius * pull.radius;
  const split = pull.densify ? densify(points, pressure, cx, cy, pull.radius) : { points: points.slice(), pressure: pressure?.slice() };
  const out = split.points;
  let moved = false;
  for (let i = 0; i + 1 < out.length; i += 2) {
    const w = weight((out[i] - cx) ** 2 + (out[i + 1] - cy) ** 2, r2);
    if (w > 0 && (dx !== 0 || dy !== 0)) {
      out[i] += dx * w;
      out[i + 1] += dy * w;
      moved = true;
    }
  }
  return { points: out, pressure: split.pressure, moved };
}

/** The cells a drag may rewrite, as the editor snapshotted them on press. */
export interface MagnetCell {
  readonly strokes: readonly Stroke[];
}

/**
 * One drag of the magnet over the cells of every selected visible layer.
 *
 * It keeps the points unrounded between moves: the document holds whole
 * units, and a slow drag passes on less than one at the rim on every move —
 * rounded each time, those lines never moved at all.
 */
export class MagnetSession {
  readonly #cells: { points: number[]; pressure?: number[]; tool_id: number; densify: boolean; tool?: ToolDescriptor }[][];

  constructor(cells: readonly MagnetCell[], tools: readonly ToolDescriptor[]) {
    this.#cells = cells.map((cell) => cell.strokes.map((stroke) => {
      const tool = tools[stroke.tool_id];
      return {
        points: [...stroke.points],
        pressure: stroke.pressure ? [...stroke.pressure] : undefined,
        tool_id: stroke.tool_id,
        // Only a line read as a polyline or a smooth chain bends by more
        // points: a stamp's points are its marks, a cubic one's count is its
        // segments'.
        densify: !!tool && tool.kind !== 'stamp' && tool.geometry !== 'cubic',
        tool,
      };
    }));
  }

  /** The new strokes of every cell, or null when no point moved. */
  drag(pull: Omit<MagnetPull, 'densify'>): Stroke[][] | null {
    let moved = false;
    for (const cell of this.#cells) {
      for (const stroke of cell) {
        const next = magnetStroke(stroke.points, stroke.pressure, { ...pull, densify: stroke.densify });
        if (!next.moved) continue;
        // More points than a stroke may hold: it bends by the ones it has.
        const fits = next.points.length <= MAX_STROKE_COORDS;
        const kept = fits ? next : magnetStroke(stroke.points, stroke.pressure, { ...pull, densify: false });
        stroke.points = kept.points;
        stroke.pressure = kept.pressure;
        moved = true;
      }
    }
    if (!moved) return null;
    return this.#cells.map((cell) => cell.map((stroke) => {
      const points = stroke.points.map(Math.round);
      if (stroke.tool) quantizeStrokePoints(points, stroke.tool);
      const out: Stroke = { points, tool_id: stroke.tool_id };
      if (stroke.pressure) out.pressure = [...stroke.pressure];
      return out;
    }));
  }
}
