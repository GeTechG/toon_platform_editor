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
): { policy: CutPolicy; width: number; cubic: boolean } {
  const tool = tools?.[stroke.tool_id];
  if (!tool) {
    return { policy: 'line', width: 0, cubic: false };
  }
  return {
    policy: cutOf?.(tool) ?? defaultCut(tool),
    width: 'width' in tool ? tool.width : 0,
    cubic: tool.geometry === 'cubic',
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
      // The walk starts from the smaller end, so a row drawn leftwards or
      // upwards comes back reversed. Kept that way, a run after the cut would
      // hold its cells out of order, and the renderer's own walk between
      // them would fill the gap straight back in.
      const backwards = between[0] !== points[i - 2] || between[1] !== points[i - 1];
      for (let j = 0; j < between.length; j += 2) {
        const k = backwards ? between.length - 2 - j : j;
        add(between[k], between[k + 1]);
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
  sweep: Sweep,
  width: number,
): ErasableStroke[] {
  const pieces: ErasableStroke[] = [];
  const points = drawnCells(stroke.points, width);
  const half = width / 2;
  // A miss gives the stroke back as it was stored, not with every in-between
  // cell written out: that would be a rewrite, and an undo step, of nothing.
  if (!points.some((v, i) => i % 2 === 0 && inside(v + half, points[i + 1] + half, sweep))) {
    return [stroke];
  }
  let run: number[] = [];
  for (let i = 0; i < points.length; i += 2) {
    if (inside(points[i] + half, points[i + 1] + half, sweep)) {
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
  sweep: Sweep,
): ErasableStroke[] {
  const { points } = stroke;
  const ring = { points: [...points, points[0], points[1]], tool_id: stroke.tool_id };
  const pieces = eraseStroke(ring, sweep);
  // Nothing was cut: give back the shape as it was, without the point the ring
  // borrowed from its own start.
  if (pieces.length === 1 && pieces[0].points.every((value, i) => value === ring.points[i])
    && pieces[0].points.length === ring.points.length) {
    return [{ points: points.slice(), tool_id: stroke.tool_id }];
  }
  const startSurvived = !inside(points[0], points[1], sweep);
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

/**
 * The gesture as the capsule tests it: its segments `[ax, ay, bx, by, …]` (a
 * gesture of one point is one segment of no length) and the box they sweep,
 * grown by the radius.
 */
interface Sweep {
  readonly segments: readonly number[];
  readonly radius: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function sweepOf(gesture: readonly number[], radius: number): Sweep {
  const segments: number[] = [];
  if (gesture.length === 2) {
    segments.push(gesture[0], gesture[1], gesture[0], gesture[1]);
  }
  for (let i = 2; i < gesture.length; i += 2) {
    segments.push(gesture[i - 2], gesture[i - 1], gesture[i], gesture[i + 1]);
  }
  return withBox(segments, radius);
}

function withBox(segments: number[], radius: number): Sweep {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < segments.length; i += 2) {
    minX = Math.min(minX, segments[i]);
    maxX = Math.max(maxX, segments[i]);
    minY = Math.min(minY, segments[i + 1]);
    maxY = Math.max(maxY, segments[i + 1]);
  }
  return { segments, radius, minX: minX - radius, minY: minY - radius, maxX: maxX + radius, maxY: maxY + radius };
}

/**
 * The part of the sweep that can reach a stroke lying in `points`' box grown
 * by `pad` — none of it, most of the time. Every sample of a stroke used to be
 * tested against every segment of the gesture, and a long sweep over a full
 * frame froze the release for seconds; a stroke the capsule never came near
 * costs one pass over its points now, and one that it did meets only the
 * segments around it. A cubic chain's control points hold its curve, so their
 * box is the curve's box too.
 */
function sweepNear(sweep: Sweep, points: readonly number[], pad: number): Sweep | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]);
    maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    maxY = Math.max(maxY, points[i + 1]);
  }
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  if (maxX < sweep.minX || minX > sweep.maxX || maxY < sweep.minY || minY > sweep.maxY) {
    return null;
  }
  const { segments, radius } = sweep;
  const near: number[] = [];
  for (let i = 0; i < segments.length; i += 4) {
    const ax = segments[i];
    const ay = segments[i + 1];
    const bx = segments[i + 2];
    const by = segments[i + 3];
    if (Math.max(ax, bx) + radius >= minX && Math.min(ax, bx) - radius <= maxX
      && Math.max(ay, by) + radius >= minY && Math.min(ay, by) - radius <= maxY) {
      near.push(ax, ay, bx, by);
    }
  }
  return near.length > 0 ? withBox(near, radius) : null;
}

/** Whether a point lies inside the capsule swept along the gesture. */
function inside(x: number, y: number, sweep: Sweep): boolean {
  if (x < sweep.minX || x > sweep.maxX || y < sweep.minY || y > sweep.maxY) {
    return false;
  }
  const { segments, radius } = sweep;
  const radiusSq = radius * radius;
  for (let i = 0; i < segments.length; i += 4) {
    if (segmentDistanceSq(x, y, segments[i], segments[i + 1], segments[i + 2], segments[i + 3]) <= radiusSq) {
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
  sweep: Sweep,
): [number, number, number] {
  const insideLo = inside(x0 + (x1 - x0) * lo, y0 + (y1 - y0) * lo, sweep);
  for (let step = 0; step < 20; step++) {
    const mid = (lo + hi) / 2;
    if (inside(x0 + (x1 - x0) * mid, y0 + (y1 - y0) * mid, sweep) === insideLo) {
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
function eraseStroke(stroke: ErasableStroke, sweep: Sweep): ErasableStroke[] {
  const { radius } = sweep;
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

  let previousInside = inside(points[0], points[1], sweep);
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
      const nowInside = inside(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, sweep);
      if (nowInside !== previousInside) {
        const [cx, cy, at] = crossing(x0, y0, x1, y1, (s - 1) / steps, t, sweep);
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

/** A stroke the capsule never reached, as a cut that missed it hands it back. */
function untouched(stroke: ErasableStroke, policy: CutPolicy): ErasableStroke {
  const pressure = policy !== 'closed' && stroke.pressure?.length === stroke.points.length / 2
    ? stroke.pressure
    : undefined;
  return pressure
    ? { points: stroke.points.slice(), tool_id: stroke.tool_id, pressure: pressure.slice() }
    : { points: stroke.points.slice(), tool_id: stroke.tool_id };
}

/** Point of the cubic `p` (8 numbers) at `t`. */
function bezierAt(p: readonly number[], t: number): [number, number] {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p[0] + b * p[2] + c * p[4] + d * p[6], a * p[1] + b * p[3] + c * p[5] + d * p[7]];
}

/** Derivative of the cubic `p` at `t`. */
function bezierSlope(p: readonly number[], t: number): [number, number] {
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const c = 3 * t * t;
  return [
    a * (p[2] - p[0]) + b * (p[4] - p[2]) + c * (p[6] - p[4]),
    a * (p[3] - p[1]) + b * (p[5] - p[3]) + c * (p[7] - p[5]),
  ];
}

/**
 * A cubic chain cut along its curve. Its stored list is a start point and
 * whole segments of six — two control points and an anchor — and the control
 * points stand off the line, so cut as a polyline it was missed where it runs,
 * cut where it does not, and left pieces the format refuses. Here each segment
 * is sampled on the curve, the crossings are found by bisection on `t`, and a
 * surviving stretch is written back as the exact sub-curve between them: every
 * piece is again a start point and whole segments, and a segment the capsule
 * missed keeps its own numbers.
 */
function eraseCubic(stroke: ErasableStroke, sweep: Sweep): ErasableStroke[] {
  const { points } = stroke;
  if ((points.length - 2) % 6 !== 0) {
    return eraseStroke(stroke, sweep);
  }
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

  let previousInside = inside(points[0], points[1], sweep);
  if (!previousInside) {
    current.push(points[0], points[1]);
    if (pressure) currentPressure.push(pressure[0]);
  }
  for (let k = 0; k + 8 <= points.length; k += 6) {
    const segment = points.slice(k, k + 8);
    const q = pressure?.slice(k / 2, k / 2 + 4);
    const qAt = (t: number): number => Math.round(q![0] + (q![3] - q![0]) * t);
    const at = (t: number): boolean => {
      const [x, y] = bezierAt(segment, t);
      return inside(x, y, sweep);
    };
    // The run that is still open in this segment began at `from`.
    let from = 0;
    const keep = (to: number): void => {
      if (from === 0 && to === 1) {
        current.push(...segment.slice(2));
        if (q) currentPressure.push(q[1], q[2], q[3]);
        return;
      }
      const [x0, y0] = bezierAt(segment, from);
      const [x3, y3] = bezierAt(segment, to);
      const [s0x, s0y] = bezierSlope(segment, from);
      const [s3x, s3y] = bezierSlope(segment, to);
      const third = (to - from) / 3;
      current.push(
        Math.round(x0 + s0x * third), Math.round(y0 + s0y * third),
        Math.round(x3 - s3x * third), Math.round(y3 - s3y * third),
        Math.round(x3), Math.round(y3),
      );
      if (q) currentPressure.push(qAt(from + third), qAt(to - third), qAt(to));
    };
    const reach = Math.hypot(segment[2] - segment[0], segment[3] - segment[1])
      + Math.hypot(segment[4] - segment[2], segment[5] - segment[3])
      + Math.hypot(segment[6] - segment[4], segment[7] - segment[5]);
    const steps = Math.max(1, Math.ceil((reach / Math.max(sweep.radius, 1)) * 2));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const nowInside = at(t);
      if (nowInside === previousInside) {
        continue;
      }
      let lo = (s - 1) / steps;
      let hi = t;
      for (let step = 0; step < 20; step++) {
        const mid = (lo + hi) / 2;
        if (at(mid) === previousInside) lo = mid;
        else hi = mid;
      }
      const cut = (lo + hi) / 2;
      if (!previousInside) {
        keep(cut);
        flush();
      } else {
        const [x, y] = bezierAt(segment, cut);
        current.push(Math.round(x), Math.round(y));
        if (q) currentPressure.push(qAt(cut));
        from = cut;
      }
      previousInside = nowInside;
    }
    if (!previousInside) {
      keep(1);
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
  const whole = sweepOf(gesture, radius);
  const result: ErasableStroke[] = [];
  for (const stroke of strokes) {
    if (stroke.points.length < 2) {
      continue;
    }
    const { policy, width, cubic } = policyOf(tools, cutOf, stroke);
    // A cell is stamped from its corner and tested at its centre: its box
    // reaches a whole width past the stored corner.
    const sweep = sweepNear(whole, stroke.points, policy === 'cells' ? width : 0);
    if (!sweep) {
      result.push(policy === 'cells' ? stroke : untouched(stroke, policy));
      continue;
    }
    if (policy === 'closed') {
      result.push(...eraseClosed(stroke, sweep));
      continue;
    }
    if (policy === 'cells') {
      result.push(...eraseCells(stroke, sweep, width));
      continue;
    }
    result.push(...(cubic ? eraseCubic(stroke, sweep) : eraseStroke(stroke, sweep)));
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
