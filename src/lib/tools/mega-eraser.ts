/**
 * Tonio's mega eraser (tools.js `MegaEraser.Erase`): the gesture is a capsule
 * of radius `width / 2` swept along its polyline, and every stored stroke it
 * touches is cut into the pieces that survive. The pieces keep the descriptor
 * of the stroke they came from; a stroke swallowed whole disappears.
 *
 * Unlike the reference this is an operation over a cell's stroke list, not a
 * stroke of its own: nothing is added to the document, so it goes through the
 * ordinary undo stack instead of being unrecoverable.
 *
 * How a stroke is cut belongs to its primitive, not to the eraser. A polyline
 * is cut into pieces; a row of grid cells loses the cells the capsule covers
 * and keeps the rest exactly where they were; a closed filled contour is cut
 * by the same capsule as a polyline, but around its ring — and each surviving
 * piece is closed into a shape of its own, because an open piece would be
 * closed and filled by the renderer into a shape nobody drew.
 */

import type { ToolDescriptor } from '../format/types';
import { isContourTool } from '../render/dispatch';
import { interpolatePixelLine } from './pixel';

export interface ErasableStroke {
  points: number[];
  tool_id: number;
  /** Pen pressure per point; a polyline cut carries it along, piece by piece. */
  pressure?: number[];
}

/** What the capsule does to a stroke of this primitive. */
export type CutPolicy = 'line' | 'cells' | 'closed';

/**
 * How a primitive is cut, when nothing said otherwise.
 *
 * A closed filled shape is cut around its ring and its pieces are closed
 * again. This is the only case the eraser knows by itself, because a contour
 * is committed by a brush's own rule, not laid down by a tool that could say
 * so; everything else is a polyline unless its tool declares another policy.
 */
function defaultCut(tool: ToolDescriptor): CutPolicy {
  return isContourTool(tool) ? 'closed' : 'line';
}

function policyOf(
  tools: readonly ToolDescriptor[] | undefined,
  cutOf: ((tool: ToolDescriptor) => CutPolicy | undefined) | undefined,
  stroke: ErasableStroke,
): { policy: CutPolicy; width: number } {
  const tool = tools?.[stroke.tool_id];
  if (!tool) {
    return { policy: 'line', width: 0 };
  }
  return {
    policy: cutOf?.(tool) ?? defaultCut(tool),
    width: 'width' in tool ? tool.width : 0,
  };
}

/**
 * Every cell the stroke actually draws: the stored ones plus the ones the
 * renderer fills between them.
 *
 * Capture stores only the cells the pointer visited, and a fast drag leaves
 * them far apart — the line on screen is the interpolation. An erase that only
 * looked at the stored cells would part them and let that same interpolation
 * join the pieces straight back up, so the cut would not show at all.
 */
function drawnCells(points: readonly number[], width: number): number[] {
  const cells: number[] = [];
  // The interpolation carries its own endpoints, and the renderer fills the
  // repeats without noticing; here they would be cells erased twice, so the
  // same cell in a row is kept once.
  const add = (x: number, y: number): void => {
    if (cells.at(-2) !== x || cells.at(-1) !== y) {
      cells.push(x, y);
    }
  };
  for (let i = 0; i < points.length; i += 2) {
    if (i >= 2) {
      const between = interpolatePixelLine(points[i - 2], points[i - 1], points[i], points[i + 1], width);
      for (let j = 0; j < between.length; j += 2) {
        add(between[j], between[j + 1]);
      }
    }
    add(points[i], points[i + 1]);
  }
  return cells;
}

/**
 * Grid cells the capsule did not cover, as runs of neighbours. A cell goes
 * when the capsule reaches its centre — the eraser's disc is over it — and the
 * cells that stay keep their own coordinates, so every square the renderer
 * fills still lines up with the grid.
 */
function eraseCells(
  stroke: ErasableStroke,
  gesture: readonly number[],
  radius: number,
  width: number,
): ErasableStroke[] {
  const pieces: ErasableStroke[] = [];
  const points = drawnCells(stroke.points, width);
  const half = width / 2;
  // A miss gives the stroke back as it was stored, not with every in-between
  // cell written out: that would be a rewrite, and an undo step, of nothing.
  if (!points.some((v, i) => i % 2 === 0 && inside(v + half, points[i + 1] + half, gesture, radius))) {
    return [stroke];
  }
  let run: number[] = [];
  for (let i = 0; i < points.length; i += 2) {
    if (inside(points[i] + half, points[i + 1] + half, gesture, radius)) {
      if (run.length >= 2) {
        pieces.push({ points: run, tool_id: stroke.tool_id });
      }
      run = [];
      continue;
    }
    run.push(points[i], points[i + 1]);
  }
  if (run.length >= 2) {
    pieces.push({ points: run, tool_id: stroke.tool_id });
  }
  return pieces;
}

/**
 * A closed shape cut around its ring: the same capsule pass as a polyline,
 * over the points with the first one repeated at the end, and every surviving
 * piece closed into a shape of its own.
 *
 * Two things make the ring a ring. The list starts at a point of the outline,
 * not at a corner of the shape, so a piece that begins at the first point and
 * one that ends at the last are two halves of the same survivor and are joined.
 * And a piece of fewer than three points is dropped — no polygon comes of it.
 *
 * ponytail: the outline, not the filled area — a capsule entirely inside a
 * large shape touches no part of the ring and leaves it alone. Subtracting it
 * properly would leave a shape with a hole, which is not a shape `contour` can
 * hold, so this stays until the format grows one.
 */
function eraseClosed(
  stroke: ErasableStroke,
  gesture: readonly number[],
  radius: number,
): ErasableStroke[] {
  const { points } = stroke;
  const ring = { points: [...points, points[0], points[1]], tool_id: stroke.tool_id };
  const pieces = eraseStroke(ring, gesture, radius);
  // Nothing was cut: give back the shape as it was, without the point the ring
  // borrowed from its own start.
  if (pieces.length === 1 && pieces[0].points.every((value, i) => value === ring.points[i])
    && pieces[0].points.length === ring.points.length) {
    return [{ points: points.slice(), tool_id: stroke.tool_id }];
  }
  const startSurvived = !inside(points[0], points[1], gesture, radius);
  if (startSurvived && pieces.length > 1) {
    // The tail ends where the head begins — on the repeated first point, which
    // the head already carries.
    const tail = pieces.pop()!;
    pieces[0] = {
      points: [...tail.points.slice(0, -2), ...pieces[0].points],
      tool_id: stroke.tool_id,
    };
  }
  return pieces.filter((piece) => piece.points.length >= 6);
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
): [number, number, number] {
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
  return [Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), t];
}

/**
 * Cuts one stroke, returning the surviving pieces in order. Segments are
 * sampled at half the radius before each crossing is refined, so a capsule
 * the stroke only dips into is still found.
 */
function eraseStroke(stroke: ErasableStroke, gesture: readonly number[], radius: number): ErasableStroke[] {
  const { points } = stroke;
  // Pressure is cut with the points: every kept point takes its own, and a
  // cut point the value between its segment's ends.
  const pressure = stroke.pressure?.length === points.length / 2 ? stroke.pressure : undefined;
  const pieces: ErasableStroke[] = [];
  let current: number[] = [];
  let currentPressure: number[] = [];
  const flush = (): void => {
    if (current.length >= 2) {
      pieces.push(pressure
        ? { points: current, tool_id: stroke.tool_id, pressure: currentPressure }
        : { points: current, tool_id: stroke.tool_id });
    }
    current = [];
    currentPressure = [];
  };

  let previousInside = inside(points[0], points[1], gesture, radius);
  if (!previousInside) {
    current.push(points[0], points[1]);
    if (pressure) currentPressure.push(pressure[0]);
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
        const [cx, cy, at] = crossing(x0, y0, x1, y1, (s - 1) / steps, t, gesture, radius);
        current.push(cx, cy);
        if (pressure) {
          const a = pressure[i / 2 - 1];
          currentPressure.push(Math.round(a + (pressure[i / 2] - a) * at));
        }
        if (!previousInside) {
          flush();
        }
        previousInside = nowInside;
      }
    }
    if (!previousInside) {
      current.push(x1, y1);
      if (pressure) currentPressure.push(pressure[i / 2]);
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
  /** The cell's tool table. Without it every stroke is read as a polyline. */
  tools?: readonly ToolDescriptor[],
  /** What the tool that lays down this primitive says about being cut. */
  cutOf?: (tool: ToolDescriptor) => CutPolicy | undefined,
): ErasableStroke[] {
  if (gesture.length < 2 || radius <= 0) {
    return strokes.map((stroke) => ({ ...stroke, points: stroke.points.slice() }));
  }
  const result: ErasableStroke[] = [];
  for (const stroke of strokes) {
    if (stroke.points.length < 2) {
      continue;
    }
    const { policy, width } = policyOf(tools, cutOf, stroke);
    if (policy === 'closed') {
      result.push(...eraseClosed(stroke, gesture, radius));
      continue;
    }
    if (policy === 'cells') {
      result.push(...eraseCells(stroke, gesture, radius, width));
      continue;
    }
    result.push(...eraseStroke(stroke, gesture, radius));
  }
  return result;
}

/**
 * Whether the eraser took anything: the pieces differ from the strokes in any
 * coordinate, not only in count — a trimmed end keeps its point count.
 */
export function strokesChanged(
  before: readonly ErasableStroke[],
  after: readonly ErasableStroke[],
): boolean {
  return after.length !== before.length
    || after.some((piece, i) => piece.points.length !== before[i].points.length
      || piece.points.some((v, j) => v !== before[i].points[j]));
}
