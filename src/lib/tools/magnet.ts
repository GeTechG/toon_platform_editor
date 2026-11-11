/**
 * The magnet: a press takes hold of the points of the lines under its circle,
 * and until the button is let go those points, and only those, follow the
 * cursor (owner, 2026-11-11: the first one moved whatever it passed over —
 * «больше похож на палец из фотошопа»). A point taken at distance `d` from the
 * press stands at where it was plus the cursor's travel from the press times
 * the strength times `(1 - (d/R)²)²`: whole under the middle, nothing at the
 * rim, so a line bends instead of breaking. Long segments under the circle are
 * split once, on the press, so a straight line of two points bends too.
 *
 * Pure: the editor snapshots the cells, hands them here, and writes what each
 * move gives back; the whole drag is one step of undo.
 */

import { MAX_STROKE_COORDS } from '../format/constants';
import type { Stroke, ToolDescriptor } from '../format/types';
import { quantizeStrokePoints } from '../model/operations';

/** How much of the cursor's travel a point at squared distance `d2` from the press takes. */
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

/** The cells a drag may rewrite, as the editor snapshotted them on press. */
export interface MagnetCell {
  readonly strokes: readonly Stroke[];
}

interface Held {
  /** Where the points stood at the press (split there, when the line bends). */
  points: number[];
  pressure?: number[];
  /** Each point's share of the cursor's travel, fixed at the press; 0 for one not taken. */
  weights: number[];
  readonly tool_id: number;
  readonly tool?: ToolDescriptor;
  readonly densify: boolean;
}

export class MagnetSession {
  readonly #cells: Held[][];
  #at: readonly [number, number] = [0, 0];
  #strength = 0;
  #took = false;

  constructor(cells: readonly MagnetCell[], tools: readonly ToolDescriptor[]) {
    this.#cells = cells.map((cell) => cell.strokes.map((stroke) => {
      const tool = tools[stroke.tool_id];
      return {
        points: [...stroke.points],
        pressure: stroke.pressure ? [...stroke.pressure] : undefined,
        weights: [],
        tool_id: stroke.tool_id,
        tool,
        // Only a line read as a polyline or a smooth chain bends by more
        // points: a stamp's points are its marks, a cubic one's count is its
        // segments'.
        densify: !!tool && tool.kind !== 'stamp' && tool.geometry !== 'cubic',
      };
    }));
  }

  /** The press: which points the circle holds, and how much of the travel each takes. */
  grab(at: readonly [number, number], radius: number, strength: number): void {
    this.#at = [at[0], at[1]];
    this.#strength = strength;
    this.#took = false;
    const r2 = radius * radius;
    for (const held of this.#cells.flat()) {
      if (held.densify) {
        const split = densify(held.points, held.pressure, at[0], at[1], radius);
        // More points than a stroke may hold: it bends by the ones it has.
        if (split.points.length <= MAX_STROKE_COORDS) {
          held.points = split.points;
          held.pressure = split.pressure;
        }
      }
      held.weights = [];
      for (let i = 0; i + 1 < held.points.length; i += 2) {
        const w = weight((held.points[i] - at[0]) ** 2 + (held.points[i + 1] - at[1]) ** 2, r2);
        held.weights.push(w);
        if (w > 0) this.#took = true;
      }
    }
  }

  /** The new strokes of every cell with the cursor at `to`, or null when the press took no point. */
  drag(to: readonly [number, number]): Stroke[][] | null {
    if (!this.#took) return null;
    const dx = (to[0] - this.#at[0]) * this.#strength;
    const dy = (to[1] - this.#at[1]) * this.#strength;
    return this.#cells.map((cell) => cell.map((held) => {
      const points = held.points.map((value, i) => Math.round(value + (i % 2 === 0 ? dx : dy) * (held.weights[i >> 1] ?? 0)));
      if (held.tool) quantizeStrokePoints(points, held.tool);
      const out: Stroke = { points, tool_id: held.tool_id };
      if (held.pressure) out.pressure = [...held.pressure];
      return out;
    }));
  }
}
