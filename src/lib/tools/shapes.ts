/**
 * The shapes tool's geometry: two points of a drag and the modifiers held
 * become the points of one polyline, in document units. Pure, so `bun test`
 * runs it; the canvas draws the drag and lays the result down as a stroke.
 *
 * Every shape is read as `line` geometry: the corners of a rectangle stay
 * corners, and an ellipse is a polyline fine enough to look round.
 */

import type { FeatherToolDescriptor, PencilToolDescriptor } from '../format/types';
import type { ResolvedStroke } from '../model/operations';
import { withOpacity } from './profiles';
import { clampCoord } from '../model/geom';

export type ShapeKind = 'line' | 'rect' | 'ellipse' | 'polygon';

export interface ShapeOptions {
  /** Shift mid-drag: a square, a circle, a line on a 15° step. */
  readonly square: boolean;
  /** Alt mid-drag: the press is the centre (the middle of a line). */
  readonly fromCentre: boolean;
  /** Sides of the polygon. */
  readonly sides: number;
}

type Point = readonly [number, number];

/**
 * How far a chord of the ellipse may sag inside the arc, in document units:
 * a quarter of a logical pixel (`FIXED_POINT_SCALE` = 8), under what a
 * screen at 1:1 shows.
 */
const ELLIPSE_SAG = 2;
/** Fewest and most segments of an ellipse: round when tiny, bounded when huge. */
const ELLIPSE_MIN_SEGMENTS = 16;
const ELLIPSE_MAX_SEGMENTS = 256;

/** Segments for a chord of the longer radius to sag no more than `ELLIPSE_SAG`. */
function ellipseSegments(radius: number): number {
  if (radius <= ELLIPSE_SAG) {
    return ELLIPSE_MIN_SEGMENTS;
  }
  const needed = Math.ceil(Math.PI / Math.acos(1 - ELLIPSE_SAG / radius));
  return Math.min(ELLIPSE_MAX_SEGMENTS, Math.max(ELLIPSE_MIN_SEGMENTS, needed));
}

/** The fewest and most sides a polygon may have. */
export const POLYGON_MIN_SIDES = 3;
export const POLYGON_MAX_SIDES = 12;

/** Sides held to 3–12, whole. */
export function clampSides(sides: number): number {
  const whole = Number.isFinite(sides) ? Math.round(sides) : POLYGON_MIN_SIDES;
  return Math.min(POLYGON_MAX_SIDES, Math.max(POLYGON_MIN_SIDES, whole));
}

/**
 * A polygon of `sides`, a vertex up, clockwise, closed. Stretched over the
 * frame — or, `regular`, scaled evenly and set in its middle, so a triangle
 * is equilateral.
 */
function polygonIn(box: Box, sides: number, regular: boolean): number[] {
  const n = clampSides(sides);
  const unit: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    unit.push([Math.cos(angle), Math.sin(angle)]);
  }
  const xs = unit.map(([x]) => x);
  const ys = unit.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  let sx = width / (maxX - minX);
  let sy = height / (maxY - minY);
  if (regular) {
    sx = sy = Math.min(sx, sy);
  }
  // Set in the middle of the frame: a no-op when it fills it.
  const ox = box.left + (width - sx * (maxX - minX)) / 2 - sx * minX;
  const oy = box.top + (height - sy * (maxY - minY)) / 2 - sy * minY;
  const points = unit.flatMap(([x, y]) => [ox + sx * x, oy + sy * y]);
  return [...points, points[0], points[1]];
}

/** The ellipse inscribed in the frame, from its top clockwise, closed. */
function ellipseIn({ left, top, right, bottom }: Box): number[] {
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const rx = (right - left) / 2;
  const ry = (bottom - top) / 2;
  const n = ellipseSegments(Math.max(rx, ry));
  const points: number[] = [];
  for (let i = 0; i <= n; i++) {
    const angle = -Math.PI / 2 + (2 * Math.PI * (i % n)) / n;
    points.push(cx + rx * Math.cos(angle), cy + ry * Math.sin(angle));
  }
  return points;
}

/** The frame a shape is fitted into: left, top, right, bottom. */
interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The two points as a frame, whichever way the drag went. */
function boxOf(a: Point, b: Point): Box {
  return {
    left: Math.min(a[0], b[0]),
    top: Math.min(a[1], b[1]),
    right: Math.max(a[0], b[0]),
    bottom: Math.max(a[1], b[1]),
  };
}

/**
 * Where the drag ends once the modifiers are read: with Shift both sides of
 * the frame take the longer one, the pointer's quadrant kept.
 */
function framedEnd(a: Point, b: Point, square: boolean): Point {
  if (!square) {
    return b;
  }
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return [a[0] + (dx < 0 ? -side : side), a[1] + (dy < 0 ? -side : side)];
}

/** The step a line turns by with Shift held. */
const LINE_STEP = Math.PI / 12;

/** The pointer turned about the press to the nearest step, as far from it as it was. */
function steppedEnd(a: Point, b: Point): Point {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  const angle = Math.round(Math.atan2(dy, dx) / LINE_STEP) * LINE_STEP;
  return [a[0] + length * Math.cos(angle), a[1] + length * Math.sin(angle)];
}

/**
 * Whole document units inside the format's int16, never a negative zero: a
 * Shift square by the edge of a big sheet, or a drag over the table at a low
 * zoom, runs past it, and the frame refuses a point out there.
 */
function whole(points: number[]): number[] {
  return points.map((v) => clampCoord(Math.round(v)) || 0);
}

export function shapePoints(kind: ShapeKind, a: Point, b: Point, options: ShapeOptions): number[] {
  const end = kind === 'line'
    ? (options.square ? steppedEnd(a, b) : b)
    : framedEnd(a, b, options.square);
  // From the centre the press is the middle: the other end is the pointer
  // mirrored through it.
  const start: Point = options.fromCentre ? [2 * a[0] - end[0], 2 * a[1] - end[1]] : a;
  if (kind === 'line') {
    return whole([start[0], start[1], end[0], end[1]]);
  }
  const box = boxOf(start, end);
  if (kind === 'ellipse') {
    return whole(ellipseIn(box));
  }
  if (kind === 'polygon') {
    return whole(polygonIn(box, options.sides, options.square));
  }
  const { left, top, right, bottom } = box;
  return whole([left, top, right, top, right, bottom, left, bottom, left, top]);
}

/** The brush a shape is laid with: the pencil's, widths in document units. */
export interface ShapeBrush {
  readonly width: number;
  readonly color: string;
  readonly fill: string;
  /** Percent 1–100. */
  readonly opacity: number;
  /** Laid filled (a feather) rather than outlined; a line never is. */
  readonly filled: boolean;
}

/**
 * The stroke a drag lays: the shape's points under the primitive that draws
 * them — a pencil for an outline, a feather for a filled one — read as
 * corners, with no pressure and none of the brush's thinning. Null when the
 * drag framed nothing.
 */
export function shapeStroke(
  kind: ShapeKind,
  a: Point,
  b: Point,
  options: ShapeOptions,
  brush: ShapeBrush,
): ResolvedStroke | null {
  const points = shapePoints(kind, a, b, options);
  const xs = points.filter((_, i) => i % 2 === 0);
  const ys = points.filter((_, i) => i % 2 === 1);
  if (Math.max(...xs) === Math.min(...xs) && Math.max(...ys) === Math.min(...ys)) {
    return null;
  }
  const outline: PencilToolDescriptor = { kind: 'pencil', geometry: 'line', width: brush.width, color: brush.color };
  const filled: FeatherToolDescriptor = { ...outline, kind: 'feather', fill: brush.fill };
  const tool = brush.filled && kind !== 'line' ? filled : outline;
  return { points, tool: withOpacity(tool, brush.opacity) };
}
