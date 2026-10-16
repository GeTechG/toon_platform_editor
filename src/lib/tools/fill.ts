/**
 * The bucket: finds the area around a press on a layer's bitmap and draws its
 * outline as a polygon, to be laid down as a `contour` stroke under the lines
 * that border it.
 *
 * Everything here works on one byte of alpha per pixel of the sheet's raster
 * and answers in its pixels: what a pixel is in document units is the
 * caller's business.
 */

import type { ToolDescriptor } from '../format/types';

/** Pixels at least this opaque stop the flood; fainter ones are the line's soft rim. */
const WALL_ALPHA = 64;
/**
 * A pocket the lines enclose inside the area smaller than this many pixels is
 * filled with it: a speck between crossing lines is not worth a ring of its own.
 */
const SPECK = 16;

type Alpha = Uint8Array | Uint8ClampedArray;

/** What `fillSlot` reads of a stroke. */
interface SlotStroke {
  readonly points: readonly number[];
  readonly tool_id: number;
}

/**
 * The area a press at (`x`, `y`) fills: 1 for every pixel of it, 0 for the
 * rest — or null when the press landed on the line itself.
 *
 * `gap`: a break in the line no wider than this many pixels holds the flood —
 * the line is swollen by half of it while the area is looked for, and the
 * area then grows back by as much over empty pixels into the corners the
 * swelling took. `grow`: how far the area reaches in under the line, over its
 * inked pixels only, so no rim of paper shows between the fill and the line
 * and a thin line is never crossed. What a line encloses inside the area stays
 * out of it — a hole — unless it is a speck.
 */
export function fillRegion(alpha: Alpha, w: number, h: number, x: number, y: number, gap: number, grow: number): Uint8Array | null {
  const seed = y * w + x;
  const wall = (p: number) => alpha[p] >= WALL_ALPHA;
  if (wall(seed)) {
    return null;
  }
  const reach = gap / 2;
  let blocked = (p: number) => wall(p);
  if (reach > 0) {
    const toWall = distanceField(w, h, wall);
    // A press into a corner narrower than the swelling still fills what it pressed.
    if (toWall[seed] > reach) {
      blocked = (p) => toWall[p] <= reach;
    }
  }
  const mask = new Uint8Array(w * h);
  mask[seed] = 1;
  spread(mask, w, h, [seed], (p) => !blocked(p), Infinity, false);
  if (reach > 0) {
    spread(mask, w, h, edgeOf(mask, w, h), (p) => !wall(p), Math.ceil(reach) + 1, true);
  }
  if (grow > 0) {
    spread(mask, w, h, edgeOf(mask, w, h), (p) => alpha[p] > 0, grow, true);
  }
  for (const hole of holesOf(mask, w, h)) {
    if (hole.length < SPECK) {
      for (const p of hole) mask[p] = 1;
    }
  }
  return mask;
}

/**
 * Floods `mask` from `from` over the pixels `open` lets in, at most `steps`
 * rings away — 8-connected when `diagonal`, so a ring is a square, else 4.
 */
function spread(
  mask: Uint8Array,
  w: number,
  h: number,
  from: readonly number[],
  open: (p: number) => boolean,
  steps: number,
  diagonal: boolean,
): void {
  let ring = [...from];
  for (let step = 0; step < steps && ring.length > 0; step++) {
    const next: number[] = [];
    for (const p of ring) {
      const px = p % w;
      const py = (p - px) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx === 0 && dy === 0) || (!diagonal && dx !== 0 && dy !== 0)) continue;
          const qx = px + dx;
          const qy = py + dy;
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
          const q = qy * w + qx;
          if (!mask[q] && open(q)) {
            mask[q] = 1;
            next.push(q);
          }
        }
      }
    }
    ring = next;
  }
}

/** The pixels of the area with a neighbour outside it. */
function edgeOf(mask: Uint8Array, w: number, h: number): number[] {
  const edge: number[] = [];
  for (let p = 0; p < w * h; p++) {
    if (!mask[p]) continue;
    const px = p % w;
    if ((px > 0 && !mask[p - 1]) || (px < w - 1 && !mask[p + 1])
      || (p >= w && !mask[p - w]) || (p + w < w * h && !mask[p + w])) {
      edge.push(p);
    }
  }
  return edge;
}

/**
 * The pockets inside the area: pixels outside it that the sheet's edge cannot
 * reach without crossing it, each pocket as its pixels, the first one its
 * topmost-leftmost.
 */
function holesOf(mask: Uint8Array, w: number, h: number): number[][] {
  const seen = new Uint8Array(w * h);
  const border: number[] = [];
  for (let p = 0; p < w * h; p++) {
    const px = p % w;
    const onBorder = px === 0 || px === w - 1 || p < w || p >= w * (h - 1);
    if (onBorder && !mask[p]) {
      seen[p] = 1;
      border.push(p);
    }
  }
  spread(seen, w, h, border, (p) => !mask[p], Infinity, false);
  const holes: number[][] = [];
  for (let p = 0; p < w * h; p++) {
    if (mask[p] || seen[p]) continue;
    // Its pixels as they are found: the first is where the scan met it.
    const hole = [p];
    seen[p] = 1;
    for (let i = 0; i < hole.length; i++) {
      const q = hole[i];
      const qx = q % w;
      for (const r of [qx > 0 ? q - 1 : -1, qx < w - 1 ? q + 1 : -1, q - w, q + w]) {
        if (r >= 0 && r < w * h && !seen[r] && !mask[r]) {
          seen[r] = 1;
          hole.push(r);
        }
      }
    }
    holes.push(hole);
  }
  return holes;
}

/**
 * Distance in pixels from every pixel to the nearest one `source` names
 * (0 on it), by a two-pass chamfer — within a few percent of the true one.
 */
export function distanceField(w: number, h: number, source: (p: number) => boolean): Float32Array {
  const d = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) d[p] = source(p) ? 0 : Infinity;
  const D = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let v = d[p];
      if (x > 0) v = Math.min(v, d[p - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[p - w] + 1);
        if (x > 0) v = Math.min(v, d[p - w - 1] + D);
        if (x < w - 1) v = Math.min(v, d[p - w + 1] + D);
      }
      d[p] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x;
      let v = d[p];
      if (x < w - 1) v = Math.min(v, d[p + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, d[p + w] + 1);
        if (x < w - 1) v = Math.min(v, d[p + w + 1] + D);
        if (x > 0) v = Math.min(v, d[p + w - 1] + D);
      }
      d[p] = v;
    }
  }
  return d;
}

/**
 * The outer outline of `mask`, as a ring of pixel corners [x0, y0, x1, y1, …]
 * walked clockwise from the top-left corner of its topmost pixel, one point
 * per turn. Pixels joined only by a corner stay one shape; holes are not
 * walked (`traceRings` walks them).
 */
export function traceOutline(mask: Uint8Array, w: number, h: number): number[] {
  const start = mask.indexOf(1);
  return start < 0 ? [] : walk((p) => mask[p] === 1, start, w, h);
}

/**
 * The outline of the area and of each hole in it: the outline clockwise, as
 * `traceOutline` walks it, then every hole the other way round — so a fill
 * of the joined path (`keyhole`) leaves the holes empty.
 */
export function traceRings(mask: Uint8Array, w: number, h: number): number[][] {
  const rings = [traceOutline(mask, w, h)];
  for (const hole of holesOf(mask, w, h)) {
    const pixels = new Set(hole);
    const ring = walk((p) => pixels.has(p), hole[0], w, h);
    const back = [ring[0], ring[1]];
    for (let i = ring.length - 2; i >= 2; i -= 2) back.push(ring[i], ring[i + 1]);
    rings.push(back);
  }
  return rings;
}

/**
 * One path out of an outline and its holes: from the outline's first corner
 * to each hole, round it and back the same way. A stretch walked there and
 * back adds nothing to what a fill covers, so the path fills as the outline
 * with holes in it — the one closed shape a `contour` stroke can hold.
 */
export function keyhole(rings: readonly (readonly number[])[]): number[] {
  const [outer, ...holes] = rings;
  const path = [...outer];
  holes.forEach((hole, i) => {
    if (i === 0) path.push(outer[0], outer[1]);
    path.push(...hole, hole[0], hole[1]);
    if (i < holes.length - 1) path.push(outer[0], outer[1]);
  });
  return path;
}

/** The clockwise walk round the shape `has` names, from its topmost-leftmost pixel `start`. */
function walk(has: (p: number) => boolean, start: number, w: number, h: number): number[] {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && has(y * w + x);
  // The pixel in quadrant (sx, sy) of corner (cx, cy).
  const quadrant = (cx: number, cy: number, sx: number, sy: number) => inside(sx < 0 ? cx - 1 : cx, sy < 0 ? cy - 1 : cy);
  const sx0 = start % w;
  const sy0 = (start - sx0) / w;
  const ring = [sx0, sy0];
  let cx = sx0;
  let cy = sy0;
  // Heading east with the shape on the right; screen y grows down, so the
  // right of (dx, dy) is (-dy, dx).
  let dx = 1;
  let dy = 0;
  for (;;) {
    cx += dx;
    cy += dy;
    if (cx === sx0 && cy === sy0) {
      return ring;
    }
    const rx = -dy;
    const ry = dx;
    let nx = dx;
    let ny = dy;
    if (quadrant(cx, cy, dx - rx, dy - ry)) {
      nx = -rx;
      ny = -ry;
    } else if (!quadrant(cx, cy, dx + rx, dy + ry)) {
      nx = rx;
      ny = ry;
    }
    if (nx !== dx || ny !== dy) {
      ring.push(cx, cy);
      dx = nx;
      dy = ny;
    }
  }
}

/**
 * Where in the layer's strokes the fill of `area` goes: under the lowest line
 * that touches the area or lies inside it — the line is the fill's border,
 * and whatever the fill covers must stay on top of it. With no such line, at
 * the bottom. A filled shape (`contour`, what the bucket lays down) is not a
 * border: a new fill over an old one goes on top of it, or the old colour hid
 * the new. An eraser that crossed the area cuts every stroke under it, so the
 * fill is kept over the last such eraser too, or it came out with a hole along
 * the old erasure.
 *
 * `scale`: raster pixels per document unit. The points are read as the
 * polyline through them, which is near enough the curve a `smooth` or `cubic`
 * geometry draws for a test of a pixel or two.
 */
export function fillSlot(
  area: Uint8Array,
  w: number,
  h: number,
  strokes: readonly SlotStroke[],
  tools: readonly ToolDescriptor[],
  scale: number,
): number {
  const toArea = distanceField(w, h, (p) => area[p] === 1);
  // One pixel of the area: a shape whose outline never comes near the area
  // holds all of it or none, and this pixel says which.
  const inArea = area.indexOf(1);
  const probe = { x: (inArea % w) + 0.5, y: Math.floor(inArea / w) + 0.5 };
  let line = -1;
  let over = 0;
  strokes.forEach((stroke, index) => {
    const tool = tools[stroke.tool_id];
    if (!tool) return;
    const under = tool.kind === 'eraser' || tool.kind === 'contour-eraser' || tool.kind === 'contour';
    // The lowest line is all it needs; what it must lie over is looked at to the top.
    if (!under && line >= 0) return;
    const hits = touches(stroke.points, tool, toArea, w, h, scale)
      || (tool.kind === 'contour' && inArea >= 0 && inside(stroke.points, probe.x / scale, probe.y / scale));
    if (!hits) return;
    if (under) over = index + 1;
    else line = index;
  });
  return Math.max(line < 0 ? 0 : line, over);
}

/** Whether (x, y) is inside the ring `points` (even–odd). */
function inside(points: readonly number[], x: number, y: number): boolean {
  let odd = false;
  for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) {
    const yi = points[i + 1];
    const yj = points[j + 1];
    if ((yi > y) !== (yj > y) && x < ((points[j] - points[i]) * (y - yi)) / (yj - yi) + points[i]) {
      odd = !odd;
    }
  }
  return odd;
}

/** Whether a stroke's ink reaches within a pixel of the area. */
function touches(
  points: readonly number[],
  tool: ToolDescriptor,
  toArea: Float32Array,
  w: number,
  h: number,
  scale: number,
): boolean {
  const width = 'width' in tool ? tool.width : 0;
  // A stamp's mark is a square `width` across around its point: its corner is the farthest ink.
  const reach = width * scale * (tool.kind === 'stamp' ? Math.SQRT1_2 : 0.5) + 1;
  const near = (x: number, y: number) => {
    const px = Math.floor(x);
    const py = Math.floor(y);
    return px >= 0 && py >= 0 && px < w && py < h && toArea[py * w + px] <= reach;
  };
  const closed = tool.kind === 'contour' || tool.kind === 'contour-eraser';
  const count = points.length / 2;
  if (count === 1) return near(points[0] * scale, points[1] * scale);
  for (let i = 0; i < (closed ? count : count - 1); i++) {
    const j = (i + 1) % count;
    const ax = points[2 * i] * scale;
    const ay = points[2 * i + 1] * scale;
    const bx = points[2 * j] * scale;
    const by = points[2 * j + 1] * scale;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    for (let k = 0; k <= steps; k++) {
      if (near(ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps)) return true;
    }
  }
  return false;
}
