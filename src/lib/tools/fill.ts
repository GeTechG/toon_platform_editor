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
import { emitGeometry, type StrokeGeometry } from '../render/smoothing';

/** Pieces a curve command is cut into; each is then walked a pixel at a time. */
const CURVE_STEPS = 8;

/** Pixels at least this opaque stop the flood; fainter ones are the line's soft rim. */
const WALL_ALPHA = 64;
/**
 * A pocket the lines enclose inside the area smaller than this many pixels is
 * filled with it: a speck between crossing lines is not worth a ring of its own.
 */
const SPECK = 16;
/** Through the hatching, how much of the outline's outer side the fill leaves to the line, px. */
const OUTLINE_KEPT = 2;

type Alpha = Uint8Array | Uint8ClampedArray;

/** What `fillPlace` reads of a stroke. */
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
 * solid pixels only, so no rim of paper shows between the fill and the line,
 * a thin line is never crossed and its soft rim on the far side is left be. What a line encloses inside the area stays
 * out of it — a hole — unless it is a speck.
 */
export function fillRegion(
  alpha: Alpha,
  w: number,
  h: number,
  x: number,
  y: number,
  gap: number,
  grow: number,
  through = false,
): Uint8Array | null {
  const seed = y * w + x;
  const wall = (p: number) => alpha[p] >= WALL_ALPHA;
  const reach = gap / 2;
  const toWall = reach > 0 ? distanceField(w, h, wall) : null;
  const swollen = (p: number) => (toWall ? toWall[p] <= reach : wall(p));
  if (wall(seed)) {
    return null;
  }
  if (through) {
    const inside = outlined(w, h, wall, swollen, toWall, reach, seed);
    if (inside) return inside;
  }
  // A press into a corner narrower than the gap still fills what it pressed.
  const blocked = toWall && !swollen(seed) ? swollen : wall;
  const mask = new Uint8Array(w * h);
  mask[seed] = 1;
  spread(mask, w, h, [seed], (p) => !blocked(p), Infinity, false);
  if (toWall) {
    regrow(mask, w, h, wall, toWall, reach);
  }
  if (grow > 0) {
    spread(mask, w, h, edgeOf(mask, w, h), wall, grow, true);
  }
  for (const hole of holesOf(mask, w, h)) {
    if (hole.length < SPECK) {
      for (const p of hole) mask[p] = 1;
    }
  }
  return mask;
}

/**
 * The area grown back into what the swelling of the lines took: the corners,
 * a few pixels deep — not deeper, or it went out through the very break the
 * swelling shut — and the strip between a line and the sheet's edge, all
 * along: that one is no break, the edge is no line.
 */
function regrow(mask: Uint8Array, w: number, h: number, wall: (p: number) => boolean, toWall: Float32Array, reach: number): void {
  // The strip: nearer the sheet's edge than any line. A break in a line is
  // nearer its two ends, wherever it lies.
  const byEdge = (p: number) => {
    const x = p % w;
    const y = (p - x) / w;
    return !wall(p) && Math.min(x, y, w - 1 - x, h - 1 - y) < toWall[p];
  };
  spread(mask, w, h, edgeOf(mask, w, h).filter(byEdge), byEdge, Infinity, false);
  spread(mask, w, h, edgeOf(mask, w, h), (p) => !wall(p), Math.ceil(reach) + 1, true);
}

/**
 * Through the hatching (the bucket's box): the whole shape an outline closes
 * round the press, the lines inside it and all — or null when the press is
 * outside every outline, and the bucket pours as ever.
 *
 * Outside is what the sheet's edge reaches without crossing a line (swollen
 * by the gap, then grown back as `fillRegion` grows); inside is the rest. The
 * outline's own solid pixels within a couple of the outside are left out, so
 * the fill keeps off the line's outer edge and never tints its soft rim.
 */
function outlined(
  w: number,
  h: number,
  wall: (p: number) => boolean,
  swollen: (p: number) => boolean,
  toWall: Float32Array | null,
  reach: number,
  seed: number,
): Uint8Array | null {
  const outside = new Uint8Array(w * h);
  const border: number[] = [];
  for (let p = 0; p < w * h; p++) {
    const px = p % w;
    const onBorder = px === 0 || px === w - 1 || p < w || p >= w * (h - 1);
    if (onBorder && !swollen(p)) {
      outside[p] = 1;
      border.push(p);
    }
  }
  spread(outside, w, h, border, (p) => !swollen(p), Infinity, false);
  if (toWall) {
    regrow(outside, w, h, wall, toWall, reach);
  }
  if (outside[seed]) {
    return null;
  }
  const mask = new Uint8Array(w * h);
  mask[seed] = 1;
  spread(mask, w, h, [seed], (p) => !outside[p], Infinity, false);
  const toOutside = distanceField(w, h, (p) => outside[p] === 1);
  for (let p = 0; p < w * h; p++) {
    if (mask[p] && wall(p) && toOutside[p] <= OUTLINE_KEPT) mask[p] = 0;
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
 * Where the fill of `area` goes among the layer's strokes, and which old
 * fills it replaces.
 *
 * An old fill (`contour`, what the bucket lays down) lying wholly in the area
 * is the same area poured again: it goes, wherever it lay — a refill is a new
 * colour, not one more layer of paint, and one that had landed over the lines
 * is mended with it.
 *
 * The new one goes under the lowest line that touches the area or lies inside
 * it — the line is its border, and the border is never covered (owner,
 * 2026-10-16). Old fills under that line stay under the new one by the same
 * token; one that lies over it covers the new fill where they meet, and an
 * eraser over it cuts it. With no line at all, it goes over every eraser and
 * fill it meets, or at the bottom.
 *
 * `slot` counts in the strokes left after the replaced ones are taken out.
 * `scale`: raster pixels per document unit.
 */
export function fillPlace(
  area: Uint8Array,
  w: number,
  h: number,
  strokes: readonly SlotStroke[],
  tools: readonly ToolDescriptor[],
  scale: number,
): { slot: number; replaced: number[] } {
  const toArea = distanceField(w, h, (p) => area[p] === 1);
  // The same area traced again comes out a pixel or two off: a ring's
  // corners lie on pixel edges, and straightening moves them (a refill
  // measured on the owner's file reached 1.2 px past the new one).
  const within = (x: number, y: number) => {
    const px = Math.min(w - 1, Math.max(0, Math.floor(x * scale)));
    const py = Math.min(h - 1, Math.max(0, Math.floor(y * scale)));
    return toArea[py * w + px] <= 3;
  };
  const replaced: number[] = [];
  const rest: SlotStroke[] = [];
  strokes.forEach((stroke, index) => {
    const tool = tools[stroke.tool_id];
    const path = tool?.kind === 'contour' ? flatten(stroke.points, tool.geometry, true) : [];
    if (path.length > 0 && path.every((v, i) => i % 2 === 1 || within(v, path[i + 1]))) {
      replaced.push(index);
    } else {
      rest.push(stroke);
    }
  });
  // One pixel of the area: a shape whose outline never comes near the area
  // holds all of it or none, and this pixel says which.
  const inArea = area.indexOf(1);
  const probe = { x: (inArea % w) + 0.5, y: Math.floor(inArea / w) + 0.5 };
  let over = 0;
  for (let index = 0; index < rest.length; index++) {
    const stroke = rest[index];
    const tool = tools[stroke.tool_id];
    if (!tool) continue;
    const under = tool.kind === 'eraser' || tool.kind === 'contour-eraser' || tool.kind === 'contour';
    const hits = touches(stroke.points, tool, toArea, w, h, scale)
      || (tool.kind === 'contour' && inArea >= 0 && inside(stroke.points, probe.x / scale, probe.y / scale));
    if (!hits) continue;
    if (!under) return { slot: index, replaced };
    over = index + 1;
  }
  return { slot: over, replaced };
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
  // Where the ink is: the curve the renderer reads out of the points, not the
  // points themselves — a quick stroke's few points lie well off its curve.
  const path = flatten(points, tool.geometry, closed);
  if (path.length === 2) return near(path[0] * scale, path[1] * scale);
  for (let i = 0; i + 3 < path.length; i += 2) {
    const ax = path[i] * scale;
    const ay = path[i + 1] * scale;
    const bx = path[i + 2] * scale;
    const by = path[i + 3] * scale;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    for (let k = 0; k <= steps; k++) {
      if (near(ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps)) return true;
    }
  }
  return false;
}

/** The stroke's path as a polyline [x0, y0, …], every curve cut into `CURVE_STEPS` pieces. */
function flatten(points: readonly number[], geometry: StrokeGeometry, closed: boolean): number[] {
  const out: number[] = [];
  let px = 0;
  let py = 0;
  const to = (x: number, y: number) => {
    out.push(x, y);
    px = x;
    py = y;
  };
  emitGeometry(points, geometry, closed, {
    moveTo: to,
    lineTo: to,
    quadraticCurveTo(cx, cy, x, y) {
      const [sx, sy] = [px, py];
      for (let k = 1; k <= CURVE_STEPS; k++) {
        const t = k / CURVE_STEPS;
        const u = 1 - t;
        to(u * u * sx + 2 * u * t * cx + t * t * x, u * u * sy + 2 * u * t * cy + t * t * y);
      }
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      const [sx, sy] = [px, py];
      for (let k = 1; k <= CURVE_STEPS; k++) {
        const t = k / CURVE_STEPS;
        const u = 1 - t;
        to(
          u * u * u * sx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x,
          u * u * u * sy + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y,
        );
      }
    },
  });
  if (closed && out.length > 2) out.push(out[0], out[1]);
  return out;
}


/**
 * A ring straightened: the staircase of pixel edges comes down to its true
 * turns, no point moving more than `tolerance` pixels off the outline. A pixel edge stands up
 * to a pixel off the line it steps along, so a tolerance under one keeps most
 * of the staircase — five times the points for a circle, and the fill's edge
 * lies under the line either way.
 */
export function simplifyRing(ring: readonly number[], tolerance = 1): number[] {
  const n = ring.length / 2;
  if (n < 4) return [...ring];
  // Douglas–Peucker on the two halves between the first point and the one
  // farthest from it: on a ring the chord of one end to itself is no line.
  let far = 0;
  for (let i = 1; i < n; i++) {
    if (Math.hypot(ring[2 * i] - ring[0], ring[2 * i + 1] - ring[1]) > Math.hypot(ring[2 * far] - ring[0], ring[2 * far + 1] - ring[1])) far = i;
  }
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[far] = 1;
  const stack: [number, number][] = [[0, far], [far, n]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const ax = ring[2 * a];
    const ay = ring[2 * a + 1];
    const bx = ring[2 * (b % n)];
    const by = ring[2 * (b % n) + 1];
    const len = Math.hypot(bx - ax, by - ay);
    let worst = -1;
    let worstAt = -1;
    for (let i = a + 1; i < b; i++) {
      const px = ring[2 * i] - ax;
      const py = ring[2 * i + 1] - ay;
      const d = len === 0 ? Math.hypot(px, py) : Math.abs(px * (by - ay) - py * (bx - ax)) / len;
      if (d > worst) {
        worst = d;
        worstAt = i;
      }
    }
    if (worst > tolerance) {
      keep[worstAt] = 1;
      stack.push([a, worstAt], [worstAt, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(ring[2 * i], ring[2 * i + 1]);
  return out;
}
