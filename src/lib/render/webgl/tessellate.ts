/**
 * Authoritative vector tessellation for the studio WebGL2 backend.
 *
 * Geometry is never re-invented: open/closed curves come from `smoothing.ts`,
 * pressured outlines come directly from `flattenPressured` + `emitPressuredOutline`
 * in `pressure.ts`, and stamp marks use `interpolatePixelLine` from `tools/pixel.ts`.
 *
 * Two conservative guards route rare pathological shapes to a tight-bbox native
 * 1x1 Canvas 2D reference coverage mask:
 * - Contours whose monotone-Y chain count could wrap an 8-bit stencil (>= 255).
 * - Subpixel strokes (< 0.5 sheet px) or sliver filled polygons whose average
 *   thickness is < 0.5 sheet px (which could slip between 4x4 grid samples).
 */

import { FIXED_POINT_SCALE } from '../../format/constants';
import { SQUARE_STAMP, type ToolDescriptor } from '../../format/types';
import { interpolatePixelLine } from '../../tools/pixel';
import {
  emitPathForTool,
  isContourTool,
  isFilledLineTool,
  isStampTool,
} from '../dispatch';
import { emitPressuredOutline, flattenPressured, pressureWidth } from '../pressure';
import { type PathSink, type StrokeGeometry } from '../smoothing';

/** Chord flatness tolerance in sheet pixels for curve and arc flattening. */
export const FLATNESS_SHEET_PX = 0.15;

/** High safety cap per Bézier command (prevents pathological loops on extreme spans). */
const MAX_CURVE_SUBDIVISIONS = 1024;

/** Maximum winding number safely represented in an 8-bit signed/unsigned stencil without wrap. */
export const MAX_STENCIL_WINDING = 255;

/** Below this projected thickness (sheet px), route to native Canvas 2D reference coverage. */
export const SUBPIXEL_THRESHOLD_PX = 0.5;

export type TessellationMode = 'union' | 'nonzero';
export type ReferenceFallbackReason = 'winding-overflow' | 'subpixel';

/**
 * Tessellated stroke geometry in document coordinates.
 *
 * - `unionVertices`: triangle list `(x, y)` drawn idempotently (BLEND off, writing 1.0 to R8).
 * - `fillVertices`: triangle-fan list `(x, y)` drawn with nonzero stencil-then-cover.
 * - `interiorVertices`: for `feather` tools, the closed interior triangle-fan list filled
 *   with `tool.fill` before the outline (`unionVertices` or `fillVertices`).
 * - `bounds`: `[minX, minY, maxX, maxY]` in document units covering all vertices.
 */
export interface StrokeMesh {
  readonly mode: TessellationMode;
  readonly unionVertices: Float32Array;
  readonly fillVertices: Float32Array;
  readonly interiorVertices: Float32Array;
  readonly bounds: readonly [number, number, number, number];
  readonly bytes: number;
  readonly fallbackReason?: ReferenceFallbackReason;
}

const EMPTY_F32 = new Float32Array(0);

/** Whether `points` represents a single dot (1 point or 2 identical points), matching canvas2d.ts. */
function isDot(points: readonly number[]): boolean {
  return points.length === 2
    || (points.length === 4 && points[0] === points[2] && points[1] === points[3]);
}

/** Whether a stamp shape is the exact unit square `[0,0, 1,0, 1,1, 0,1]`. */
function isSquareShape(shape: readonly number[]): boolean {
  if (shape.length !== SQUARE_STAMP.length) return false;
  for (let i = 0; i < shape.length; i++) {
    if (shape[i] !== SQUARE_STAMP[i]) return false;
  }
  return true;
}

/** Minimum projected stroke width in sheet pixels (returns Infinity for widthless contours). */
export function minProjectedStrokeWidth(
  tool: ToolDescriptor,
  rasterLevel: number,
  pressure?: readonly number[],
): number {
  if (!('width' in tool)) return Infinity;
  const scale = rasterLevel / FIXED_POINT_SCALE;
  if (pressure && pressure.length > 0 && !isStampTool(tool)) {
    let minQ = pressure[0];
    for (let i = 1; i < pressure.length; i++) {
      if (pressure[i] < minQ) minQ = pressure[i];
    }
    return pressureWidth(tool.width, minQ) * scale;
  }
  return tool.width * scale;
}

/**
 * Counts strict direction reversals along the Y axis in a closed polygon `[x0,y0,...]`.
 * Each horizontal scanline can cross at most `ceil(chains / 2)` edges in the same
 * direction, giving a fast O(N) conservative upper bound on |winding|.
 */
export function countMonotoneYChains(ring: readonly number[]): number {
  const n = ring.length / 2;
  if (n < 3) return 0;
  let firstDir = 0;
  let prevDir = 0;
  let chains = 0;
  for (let i = 0; i < n; i++) {
    const y0 = ring[i * 2 + 1];
    const y1 = ring[((i + 1) % n) * 2 + 1];
    const dy = y1 - y0;
    if (dy === 0) continue;
    const dir = dy > 0 ? 1 : -1;
    if (firstDir === 0) {
      firstDir = dir;
      prevDir = dir;
      chains = 1;
    } else if (dir !== prevDir) {
      chains++;
      prevDir = dir;
    }
  }
  if (chains > 1 && prevDir === firstDir) {
    chains--;
  }
  return chains;
}

/**
 * Conservative classifier for filled shapes (`contour`, `contour-eraser`,
 * `feather` interior, custom `stamp`) whose thin features could slip between
 * 4x4 fixed-grid coverage samples (e.g. a long diagonal sliver 1/16 px wide
 * with a large bounding box).
 *
 * Uses hydraulic thickness `2 * |Area| / Perimeter` in sheet pixels (equals exact
 * strip width for any long thin rectangle/sliver, and `s / 2` for an `s×s` square).
 */
export function classifyThinFill(ring: readonly number[], rasterLevel: number): boolean {
  const n = ring.length / 2;
  if (n < 3) return true;
  const scale = rasterLevel / FIXED_POINT_SCALE;
  let area2 = 0;
  let perim = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const ax = ring[i * 2] * scale;
    const ay = ring[i * 2 + 1] * scale;
    const j = (i + 1) % n;
    const bx = ring[j * 2] * scale;
    const by = ring[j * 2 + 1] * scale;
    area2 += ax * by - bx * ay;
    perim += Math.hypot(bx - ax, by - ay);
    if (ax < minX) minX = ax;
    if (ax > maxX) maxX = ax;
    if (ay < minY) minY = ay;
    if (ay > maxY) maxY = ay;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (w < SUBPIXEL_THRESHOLD_PX || h < SUBPIXEL_THRESHOLD_PX) return true;
  if (perim <= 0) return true;
  const avgThickness = Math.abs(area2) / perim; // = 2 * |area| / perimeter
  return avgThickness < SUBPIXEL_THRESHOLD_PX;
}

/** Adaptive quadratic Bézier flattening into `out` `[x,y,...]` within `tolDoc` doc units. */
function flattenQuad(
  x0: number, y0: number, cx: number, cy: number, x1: number, y1: number,
  tolDoc: number, out: number[],
): void {
  // Exact max deviation of quadratic Bézier from chord is 0.5 * dist(mid(p0,p1), c).
  const dx = (x0 + x1) * 0.5 - cx;
  const dy = (y0 + y1) * 0.5 - cy;
  const dev = Math.hypot(dx, dy) * 0.5;
  const steps = Math.min(
    MAX_CURVE_SUBDIVISIONS,
    Math.max(1, Math.ceil(Math.sqrt(dev / Math.max(1e-4, tolDoc)))),
  );
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push(
      u * u * x0 + 2 * u * t * cx + t * t * x1,
      u * u * y0 + 2 * u * t * cy + t * t * y1,
    );
  }
}

/** Adaptive cubic Bézier flattening into `out` `[x,y,...]` within `tolDoc` doc units (Wang's bound). */
function flattenCubic(
  x0: number, y0: number, c1x: number, c1y: number, c2x: number, c2y: number, x1: number, y1: number,
  tolDoc: number, out: number[],
): void {
  // Wang's formula upper bound on second derivative magnitude.
  const ax = x0 - 2 * c1x + c2x;
  const ay = y0 - 2 * c1y + c2y;
  const bx = c1x - 2 * c2x + x1;
  const by = c1y - 2 * c2y + y1;
  const m = Math.max(Math.hypot(ax, ay), Math.hypot(bx, by));
  const steps = Math.min(
    MAX_CURVE_SUBDIVISIONS,
    Math.max(1, Math.ceil(Math.sqrt((0.75 * m) / Math.max(1e-4, tolDoc)))),
  );
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push(
      a * x0 + b * c1x + c * c2x + d * x1,
      a * y0 + b * c1y + c * c2y + d * y1,
    );
  }
}

/** Collects flattened subpaths from any PathSink emitter. */
function collectFlattenedSubpaths(
  emit: (sink: PathSink) => void,
  tolDoc: number,
): number[][] {
  const subpaths: number[][] = [];
  let cur: number[] | null = null;
  let px = 0;
  let py = 0;
  emit({
    moveTo(x, y) {
      cur = [x, y];
      subpaths.push(cur);
      px = x;
      py = y;
    },
    lineTo(x, y) {
      if (!cur) {
        cur = [x, y];
        subpaths.push(cur);
      } else {
        cur.push(x, y);
      }
      px = x;
      py = y;
    },
    quadraticCurveTo(cx, cy, x, y) {
      if (!cur) {
        cur = [px, py];
        subpaths.push(cur);
      }
      flattenQuad(px, py, cx, cy, x, y, tolDoc, cur);
      px = x;
      py = y;
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      if (!cur) {
        cur = [px, py];
        subpaths.push(cur);
      }
      flattenCubic(px, py, c1x, c1y, c2x, c2y, x, y, tolDoc, cur);
      px = x;
      py = y;
    },
  });
  return subpaths;
}

/** Flattens an arc emitted by `emitPressuredOutline` to within `tolDoc`. */
function flattenArc(
  cx: number, cy: number, r: number, a0: number, a1: number, ccw: boolean,
  tolDoc: number, out: number[],
): void {
  if (r <= 0) {
    out.push(cx, cy);
    return;
  }
  let sweep = a1 - a0;
  if (ccw) {
    if (sweep > 0) sweep -= Math.PI * 2;
    else if (sweep < -Math.PI * 2) sweep = -Math.PI * 2;
  } else {
    if (sweep < 0) sweep += Math.PI * 2;
    else if (sweep > Math.PI * 2) sweep = Math.PI * 2;
  }
  const absSweep = Math.abs(sweep);
  if (absSweep < 1e-6) return;
  const maxAngle = r > tolDoc ? 2 * Math.acos(Math.max(-1, 1 - tolDoc / r)) : Math.PI / 2;
  const steps = Math.min(MAX_CURVE_SUBDIVISIONS, Math.max(2, Math.ceil(absSweep / Math.max(1e-3, maxAngle))));
  for (let i = 1; i <= steps; i++) {
    const a = a0 + (sweep * i) / steps;
    out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
}

/** Emits a triangle fan from anchor `(ax, ay)` around every closed subpath for stencil-then-cover. */
function buildStencilFans(subpaths: readonly (readonly number[])[]): Float32Array {
  let triCount = 0;
  for (const ring of subpaths) {
    const n = ring.length / 2;
    if (n >= 3) triCount += n;
  }
  if (triCount === 0) return EMPTY_F32;
  const out = new Float32Array(triCount * 6);
  let o = 0;
  for (const ring of subpaths) {
    const n = ring.length / 2;
    if (n < 3) continue;
    // Anchor at first vertex: every triangle lies inside the subpath's AABB.
    const ax = ring[0];
    const ay = ring[1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      out[o++] = ax;
      out[o++] = ay;
      out[o++] = ring[i * 2];
      out[o++] = ring[i * 2 + 1];
      out[o++] = ring[j * 2];
      out[o++] = ring[j * 2 + 1];
    }
  }
  return out;
}

/** Circle points at the same flatness for every round join and cap of the stroke. */
function circleFanOffsets(r: number, tolDoc: number): Float64Array {
  const maxAngle = r > tolDoc ? 2 * Math.acos(Math.max(-1, 1 - tolDoc / r)) : Math.PI / 4;
  const steps = Math.min(256, Math.max(8, Math.ceil((Math.PI * 2) / Math.max(1e-3, maxAngle))));
  // Keep offsets at double precision until the center is added, just like
  // the segment corners. Rounding the offsets first can shift coverage.
  const offsets = new Float64Array(2 * (steps + 1));
  offsets[0] = r;
  for (let i = 1; i <= steps; i++) {
    const angle = (i * Math.PI * 2) / steps;
    offsets[i * 2] = Math.cos(angle) * r;
    offsets[i * 2 + 1] = Math.sin(angle) * r;
  }
  return offsets;
}

function writeCircleFan(out: Float32Array, offset: number, cx: number, cy: number, offsets: Float64Array): number {
  let px = cx + offsets[0];
  let py = cy;
  for (let i = 2; i < offsets.length; i += 2) {
    const nx = cx + offsets[i];
    const ny = cy + offsets[i + 1];
    out[offset++] = cx;
    out[offset++] = cy;
    out[offset++] = px;
    out[offset++] = py;
    out[offset++] = nx;
    out[offset++] = ny;
    px = nx;
    py = ny;
  }
  return offset;
}

/**
 * Expands an open polyline `[x0,y0,...]` of constant width into triangles:
 * segment quads + round caps + round joins. Written idempotently into R8
 * (BLEND off), so internal triangle overlaps at caps/joins are exact.
 */
function expandPolylineRibbon(poly: readonly number[], width: number, tolDoc: number): Float32Array {
  const n = poly.length / 2;
  if (n === 0) return EMPTY_F32;
  const r = width / 2;
  const fan = circleFanOffsets(r, tolDoc);
  const fanFloats = (fan.length - 2) * 3;
  const lengths = new Float64Array(n - 1);
  let segmentCount = 0;
  for (let i = 0; i < lengths.length; i++) {
    const len = Math.hypot(poly[(i + 1) * 2] - poly[i * 2], poly[(i + 1) * 2 + 1] - poly[i * 2 + 1]);
    if (len < 1e-6) continue;
    lengths[i] = len;
    segmentCount++;
  }
  const out = new Float32Array(segmentCount * (12 + fanFloats) + fanFloats);
  let offset = 0;
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i];
    if (len === 0) continue;
    const x0 = poly[i * 2];
    const y0 = poly[i * 2 + 1];
    const x1 = poly[(i + 1) * 2];
    const y1 = poly[(i + 1) * 2 + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const nx = (-dy / len) * r;
    const ny = (dx / len) * r;
    const ax = x0 + nx, ay = y0 + ny;
    const bx = x0 - nx, by = y0 - ny;
    const cx = x1 + nx, cy = y1 + ny;
    const ddx = x1 - nx, ddy = y1 - ny;
    out[offset++] = ax;
    out[offset++] = ay;
    out[offset++] = bx;
    out[offset++] = by;
    out[offset++] = cx;
    out[offset++] = cy;
    out[offset++] = bx;
    out[offset++] = by;
    out[offset++] = ddx;
    out[offset++] = ddy;
    out[offset++] = cx;
    out[offset++] = cy;
    // Round join/cap circles at vertices: idempotent R8 write means exact union.
    offset = writeCircleFan(out, offset, x0, y0, fan);
  }
  writeCircleFan(out, offset, poly[(n - 1) * 2], poly[(n - 1) * 2 + 1], fan);
  return out;
}

function computeBounds(...arrays: Float32Array[]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const arr of arrays) {
    for (let i = 0; i < arr.length; i += 2) {
      const x = arr[i];
      const y = arr[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return [0, 0, 0, 0];
  return [minX, minY, maxX, maxY];
}

function pointsBounds(points: readonly number[], padDoc: number): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i];
    const y = points[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return [0, 0, 0, 0];
  return [minX - padDoc, minY - padDoc, maxX + padDoc, maxY + padDoc];
}

function exceedsWindingLimit(subpaths: readonly (readonly number[])[]): boolean {
  let totalHalfChains = 0;
  for (const ring of subpaths) {
    totalHalfChains += Math.ceil(countMonotoneYChains(ring) / 2);
    if (totalHalfChains >= MAX_STENCIL_WINDING) return true;
  }
  return false;
}

/**
 * Tessellates any stroke (`points`, `tool`, `rasterLevel`, optional `pressure`)
 * into document-space vertices and exact bounds, or flags a conservative
 * Canvas 2D reference fallback reason (`winding-overflow` or `subpixel`).
 */
export function tessellateStroke(
  points: readonly number[],
  tool: ToolDescriptor,
  rasterLevel: number,
  pressure?: readonly number[],
): StrokeMesh {
  if (points.length < 2) {
    return {
      mode: 'union',
      unionVertices: EMPTY_F32,
      fillVertices: EMPTY_F32,
      interiorVertices: EMPTY_F32,
      bounds: [0, 0, 0, 0],
      bytes: 64,
    };
  }
  const scale = rasterLevel / FIXED_POINT_SCALE;
  const tolDoc = FLATNESS_SHEET_PX / Math.max(1e-6, scale);

  // 1. Subpixel width guard for stroked tools (pencil, eraser, feather, stamp).
  if (minProjectedStrokeWidth(tool, rasterLevel, pressure) < SUBPIXEL_THRESHOLD_PX) {
    const pad = 'width' in tool ? tool.width : 0;
    return {
      mode: 'union',
      unionVertices: EMPTY_F32,
      fillVertices: EMPTY_F32,
      interiorVertices: EMPTY_F32,
      bounds: pointsBounds(points, pad),
      bytes: 64,
      fallbackReason: 'subpixel',
    };
  }

  // 2. Stamp tool (unit square = seamless union quads; arbitrary polygon = nonzero fans).
  if (isStampTool(tool)) {
    const places: number[] = [];
    for (let i = 0; i < points.length; i += 2) {
      if (i >= 2) {
        const between = interpolatePixelLine(points[i - 2], points[i - 1], points[i], points[i + 1], tool.width);
        for (let j = 0; j < between.length; j++) places.push(between[j]);
      }
      places.push(points[i], points[i + 1]);
    }
    if (isSquareShape(tool.shape)) {
      const w = tool.width;
      const verts = new Float32Array((places.length / 2) * 12);
      let o = 0;
      for (let i = 0; i < places.length; i += 2) {
        const x0 = places[i];
        const y0 = places[i + 1];
        const x1 = x0 + w;
        const y1 = y0 + w;
        verts[o++] = x0; verts[o++] = y0;
        verts[o++] = x1; verts[o++] = y0;
        verts[o++] = x1; verts[o++] = y1;
        verts[o++] = x0; verts[o++] = y0;
        verts[o++] = x1; verts[o++] = y1;
        verts[o++] = x0; verts[o++] = y1;
      }
      return {
        mode: 'union',
        unionVertices: verts,
        fillVertices: EMPTY_F32,
        interiorVertices: EMPTY_F32,
        bounds: computeBounds(verts),
        bytes: verts.byteLength + 64,
      };
    }
    // Arbitrary polygon stamp: check thinness on one prototype polygon at (0, 0).
    const proto: number[] = [];
    for (let k = 0; k < tool.shape.length; k += 2) {
      proto.push(tool.shape[k] * tool.width, tool.shape[k + 1] * tool.width);
    }
    if (classifyThinFill(proto, rasterLevel)) {
      return {
        mode: 'nonzero',
        unionVertices: EMPTY_F32,
        fillVertices: EMPTY_F32,
        interiorVertices: EMPTY_F32,
        bounds: pointsBounds(places, tool.width),
        bytes: 64,
        fallbackReason: 'subpixel',
      };
    }
    const subpaths: number[][] = [];
    for (let i = 0; i < places.length; i += 2) {
      const px = places[i];
      const py = places[i + 1];
      const ring: number[] = [];
      for (let k = 0; k < tool.shape.length; k += 2) {
        ring.push(px + tool.shape[k] * tool.width, py + tool.shape[k + 1] * tool.width);
      }
      subpaths.push(ring);
    }
    if (exceedsWindingLimit(subpaths)) {
      return {
        mode: 'nonzero',
        unionVertices: EMPTY_F32,
        fillVertices: EMPTY_F32,
        interiorVertices: EMPTY_F32,
        bounds: pointsBounds(places, tool.width),
        bytes: 64,
        fallbackReason: 'winding-overflow',
      };
    }
    const fillVertices = buildStencilFans(subpaths);
    return {
      mode: 'nonzero',
      unionVertices: EMPTY_F32,
      fillVertices,
      interiorVertices: EMPTY_F32,
      bounds: computeBounds(fillVertices),
      bytes: fillVertices.byteLength + 64,
    };
  }

  // 3. Closed contour / contour-eraser (nonzero stencil-then-cover).
  if (isContourTool(tool)) {
    const subpaths = collectFlattenedSubpaths((sink) => emitPathForTool(points, tool, sink), tolDoc);
    if (exceedsWindingLimit(subpaths)) {
      return {
        mode: 'nonzero',
        unionVertices: EMPTY_F32,
        fillVertices: EMPTY_F32,
        interiorVertices: EMPTY_F32,
        bounds: pointsBounds(points, 0),
        bytes: 64,
        fallbackReason: 'winding-overflow',
      };
    }
    if (subpaths.some((ring) => classifyThinFill(ring, rasterLevel))) {
      return {
        mode: 'nonzero',
        unionVertices: EMPTY_F32,
        fillVertices: EMPTY_F32,
        interiorVertices: EMPTY_F32,
        bounds: pointsBounds(points, 0),
        bytes: 64,
        fallbackReason: 'subpixel',
      };
    }
    const fillVertices = buildStencilFans(subpaths);
    return {
      mode: 'nonzero',
      unionVertices: EMPTY_F32,
      fillVertices,
      interiorVertices: EMPTY_F32,
      bounds: computeBounds(fillVertices),
      bytes: fillVertices.byteLength + 64,
    };
  }

  // 4. Pressured line/feather stroke: authoritative emitPressuredOutline!
  const hasPressure = pressure !== undefined && pressure.length === points.length / 2;
  if (hasPressure) {
    let interiorVertices: Float32Array = EMPTY_F32;
    if (isFilledLineTool(tool)) {
      const inner = collectFlattenedSubpaths((sink) => emitPathForTool(points, tool, sink), tolDoc);
      if (exceedsWindingLimit(inner)) {
        return {
          mode: 'nonzero',
          unionVertices: EMPTY_F32,
          fillVertices: EMPTY_F32,
          interiorVertices: EMPTY_F32,
          bounds: pointsBounds(points, tool.width),
          bytes: 64,
          fallbackReason: 'winding-overflow',
        };
      }
      interiorVertices = buildStencilFans(inner);
    }
    const flat = flattenPressured(points, pressure, tool.geometry);
    const outlineSubpaths: number[][] = [];
    let cur: number[] | null = null;
    emitPressuredOutline(flat, tool.width, {
      moveTo(x, y) {
        cur = [x, y];
        outlineSubpaths.push(cur);
      },
      lineTo(x, y) {
        if (!cur) {
          cur = [x, y];
          outlineSubpaths.push(cur);
        } else {
          cur.push(x, y);
        }
      },
      arc(cx, cy, r, a0, a1, ccw) {
        if (!cur) {
          cur = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r];
          outlineSubpaths.push(cur);
        }
        flattenArc(cx, cy, r, a0, a1, Boolean(ccw), tolDoc, cur);
      },
    });
    if (exceedsWindingLimit(outlineSubpaths)) {
      return {
        mode: 'nonzero',
        unionVertices: EMPTY_F32,
        fillVertices: EMPTY_F32,
        interiorVertices: EMPTY_F32,
        bounds: pointsBounds(points, tool.width),
        bytes: 64,
        fallbackReason: 'winding-overflow',
      };
    }
    const fillVertices = buildStencilFans(outlineSubpaths);
    return {
      mode: 'nonzero',
      unionVertices: EMPTY_F32,
      fillVertices,
      interiorVertices,
      bounds: computeBounds(fillVertices, interiorVertices),
      bytes: fillVertices.byteLength + interiorVertices.byteLength + 64,
    };
  }

  // 5. Constant-width dot.
  if (isDot(points)) {
    const fan = circleFanOffsets(tool.width / 2, tolDoc);
    const unionVertices = new Float32Array((fan.length - 2) * 3);
    writeCircleFan(unionVertices, 0, points[0], points[1], fan);
    return {
      mode: 'union',
      unionVertices,
      fillVertices: EMPTY_F32,
      interiorVertices: EMPTY_F32,
      bounds: computeBounds(unionVertices),
      bytes: unionVertices.byteLength + 64,
    };
  }

  // 6. Constant-width pencil / eraser / feather.
  const subpaths = collectFlattenedSubpaths((sink) => emitPathForTool(points, tool, sink), tolDoc);
  const poly = subpaths[0] ?? [];
  const unionVertices = expandPolylineRibbon(poly, tool.width, tolDoc);
  let interiorVertices: Float32Array = EMPTY_F32;
  if (isFilledLineTool(tool) && poly.length >= 6) {
    if (exceedsWindingLimit([poly])) {
      return {
        mode: 'union',
        unionVertices: EMPTY_F32,
        fillVertices: EMPTY_F32,
        interiorVertices: EMPTY_F32,
        bounds: pointsBounds(points, tool.width),
        bytes: 64,
        fallbackReason: 'winding-overflow',
      };
    }
    interiorVertices = buildStencilFans([poly]);
  }
  return {
    mode: 'union',
    unionVertices,
    fillVertices: EMPTY_F32,
    interiorVertices,
    bounds: computeBounds(unionVertices, interiorVertices),
    bytes: unionVertices.byteLength + interiorVertices.byteLength + 64,
  };
}

/** Tessellates an arbitrary raw/incremental live polyline (used for declarative LiveLine). */
export function tessellateLivePolyline(
  points: readonly number[],
  geometry: StrokeGeometry,
  width: number,
  rasterLevel: number,
  fillInterior = false,
): StrokeMesh {
  const tool: ToolDescriptor = fillInterior
    ? { kind: 'feather', geometry, width, color: '#000000', fill: '#000000' }
    : { kind: 'pencil', geometry, width, color: '#000000' };
  return tessellateStroke(points, tool, rasterLevel);
}

/** Geometry-only key for a tool descriptor (color/opacity/buildup do not alter vertices). */
function toolGeometryKey(tool: ToolDescriptor): string {
  const width = 'width' in tool ? tool.width : '';
  const shape = tool.kind === 'stamp' ? tool.shape.join(',') : '';
  return `${tool.kind}:${tool.geometry}:${width}:${shape}`;
}

interface KeptGeometry {
  readonly pressure: readonly number[] | undefined;
  readonly toolKey: string;
  readonly rasterLevel: number;
  readonly mesh: StrokeMesh;
}

/**
 * Budgeted LRU mesh cache keyed by `points` array identity, `pressure` array
 * identity, geometry-affecting tool fields, and `rasterLevel`.
 */
export class GeometryKeeper {
  readonly #budget: number;
  readonly #entries = new Map<readonly number[], KeptGeometry>();
  #bytes = 0;

  constructor(budget: number) {
    this.#budget = budget;
  }

  take(
    points: readonly number[],
    tool: ToolDescriptor,
    rasterLevel: number,
    pressure: readonly number[] | undefined,
    build: () => StrokeMesh,
  ): StrokeMesh {
    const toolKey = toolGeometryKey(tool);
    const existing = this.#entries.get(points);
    if (
      existing
      && existing.pressure === pressure
      && existing.toolKey === toolKey
      && existing.rasterLevel === rasterLevel
    ) {
      this.#entries.delete(points);
      this.#entries.set(points, existing);
      return existing.mesh;
    }
    const mesh = build();
    if (mesh.bytes > this.#budget) {
      return mesh;
    }
    if (existing) {
      this.#entries.delete(points);
      this.#bytes -= existing.mesh.bytes;
    }
    while (this.#bytes + mesh.bytes > this.#budget && this.#entries.size > 0) {
      const oldestKey = this.#entries.keys().next().value!;
      const oldest = this.#entries.get(oldestKey)!;
      this.#entries.delete(oldestKey);
      this.#bytes -= oldest.mesh.bytes;
    }
    this.#entries.set(points, { pressure, toolKey, rasterLevel, mesh });
    this.#bytes += mesh.bytes;
    return mesh;
  }

  get bytes(): number {
    return this.#bytes;
  }

  clear(): void {
    this.#entries.clear();
    this.#bytes = 0;
  }
}
