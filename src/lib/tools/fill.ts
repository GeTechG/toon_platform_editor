/**
 * The bucket: finds the area of the colour seen under a press on the sheet's
 * bitmap, whatever made that colour, and draws its outline as a polygon, to be
 * laid down as a `contour` stroke as low as it stays seen.
 *
 * Everything here works on the sheet's raster and answers in its pixels: what
 * a pixel is in document units is the caller's business.
 */

import type { ToolDescriptor } from '../format/types';
import { emitGeometry, type StrokeGeometry } from '../render/smoothing';

/** Pieces a curve command is cut into; each is then walked a pixel at a time. */
const CURVE_STEPS = 8;

/**
 * A pocket the lines enclose inside the area smaller than this many pixels is
 * filled with it: a speck between crossing lines is not worth a ring of its own.
 */
const SPECK = 16;

/** What `fillPlace` reads of a stroke. */
interface SlotStroke {
  readonly points: readonly number[];
  readonly tool_id: number;
}

/**
 * How far every pixel of the sheet is from the colour seen at (`x`, `y`): the
 * largest difference over the three channels, 0..255. A pixel is seen as its
 * paint over `paper`, so ink as white as the paper is the paper to the bucket,
 * as to the eye, and a half-covered pixel is the mix it looks like.
 */
export function colourDistance(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  paper: readonly number[],
): Uint8Array {
  const n = w * h;
  const seen = new Uint8Array(n * 3);
  for (let p = 0; p < n; p++) {
    const a = rgba[p * 4 + 3];
    for (let c = 0; c < 3; c++) {
      seen[p * 3 + c] = (rgba[p * 4 + c] * a + paper[c] * (255 - a) + 127) / 255;
    }
  }
  const seed = (y * w + x) * 3;
  const [r, g, b] = [seen[seed], seen[seed + 1], seen[seed + 2]];
  const distance = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    distance[p] = Math.max(Math.abs(seen[p * 3] - r), Math.abs(seen[p * 3 + 1] - g), Math.abs(seen[p * 3 + 2] - b));
  }
  return distance;
}

/**
 * The area a press at (`x`, `y`) pours over: 1 for every connected pixel no
 * further than `tolerance` from the colour pressed (`colourDistance`), 0 for
 * the rest.
 *
 * `gap`: a break no wider than this many pixels in what stops the flood holds
 * it — what stops it is swollen by half of that while the area is looked for,
 * and the area then grows back by as much into the corners the swelling took.
 * What the area encloses stays out of it — a hole — unless it is a speck.
 */
export function fillRegion(
  distance: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  tolerance: number,
  gap: number,
): Uint8Array {
  const seed = y * w + x;
  const wall = (p: number) => distance[p] > tolerance;
  const reach = gap / 2;
  const toWall = reach > 0 ? distanceField(w, h, wall) : null;
  const swollen = (p: number) => (toWall ? toWall[p] <= reach : wall(p));
  // A press into a corner narrower than the gap still fills what it pressed.
  const blocked = toWall && !swollen(seed) ? swollen : wall;
  const mask = new Uint8Array(w * h);
  mask[seed] = 1;
  const corners = softCorners(distance, w, h);
  spread(mask, w, h, [seed], (p) => !blocked(p), Infinity, corners);
  if (toWall) {
    regrow(mask, w, h, wall, toWall, reach);
    if (blocked === swollen) {
      takeNarrow(mask, w, h, seed, wall, swollen, corners);
    }
  }
  takeSpecks(mask, w, h);
  return mask;
}

/**
 * Back into the area, what the swelling cut off and is narrower than the gap
 * all through: the thin tail of a stroke with pressure, the point of a sharp
 * corner. What leaks out through a break is never that: it widens behind it.
 */
function takeNarrow(
  mask: Uint8Array,
  w: number,
  h: number,
  seed: number,
  wall: (p: number) => boolean,
  swollen: (p: number) => boolean,
  corners: CornerRule,
): void {
  const whole = new Uint8Array(w * h);
  whole[seed] = 1;
  spread(whole, w, h, [seed], (p) => !wall(p), Infinity, corners);
  const seen = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    if (!whole[p] || mask[p] || seen[p]) continue;
    seen[p] = 1;
    const piece = [p];
    spread(seen, w, h, [p], (q) => {
      if (!whole[q] || mask[q]) return false;
      piece.push(q);
      return true;
    }, Infinity, false);
    if (piece.every(swollen)) {
      for (const q of piece) mask[q] = 1;
    }
  }
}

/**
 * The area grown over the soft edge of what borders it, `steps` rings at most,
 * so no rim of the old colour is left: a pixel is taken while the colour keeps
 * moving away from the one pressed, and there is further still to go — the
 * solid ink behind the edge is left be, as is the far side of a thin line.
 * `underInk`: ink lies over the fill, so its first solid pixel is taken too, or
 * the paper would show through the edge of the line.
 */
export function growRim(
  mask: Uint8Array,
  distance: Uint8Array,
  w: number,
  h: number,
  steps: number,
  underInk: boolean,
): void {
  const around = (p: number, visit: (q: number) => void) => {
    const px = p % w;
    const py = (p - px) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const qx = px + dx;
        const qy = py + dy;
        if ((dx || dy) && qx >= 0 && qy >= 0 && qx < w && qy < h) visit(qy * w + qx);
      }
    }
  };
  const goesOn = (q: number) => {
    let further = false;
    around(q, (r) => {
      if (distance[r] > distance[q]) further = true;
    });
    return further;
  };
  let ring = edgeOf(mask, w, h);
  for (let step = 0; step < steps && ring.length > 0; step++) {
    const next: number[] = [];
    for (const p of ring) {
      around(p, (q) => {
        if (!mask[q] && distance[q] > distance[p] && (underInk || goesOn(q))) {
          mask[q] = 1;
          next.push(q);
        }
      });
    }
    ring = next;
  }
  takeSpecks(mask, w, h);
}

/** How much further a neighbour must be for a pixel to count as soft: a line's own unevenness is less. */
const SOFT_STEP = 32;

/** Whether a flood may step from one pixel to its diagonal neighbour, given the two pixels between. */
type CornerRule = (a: number, b: number) => boolean;

/**
 * A flood steps through a pixel corner only between two soft pixels, those with
 * something further from the colour pressed behind them: the blended sides of a
 * thin smooth line, whose core at 45° is joined only by corners. Two solid
 * pixels meeting at a corner are a wall, or a hard line a pixel wide would leak.
 */
function softCorners(distance: Uint8Array, w: number, h: number): CornerRule {
  const soft = (p: number) => {
    const px = p % w;
    const py = (p - px) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const qx = px + dx;
        const qy = py + dy;
        if (qx >= 0 && qy >= 0 && qx < w && qy < h && distance[qy * w + qx] > distance[p] + SOFT_STEP) return true;
      }
    }
    return false;
  };
  return (a, b) => soft(a) && soft(b);
}

/** A pocket of the area too small to be worth a ring of its own goes into the area. */
function takeSpecks(mask: Uint8Array, w: number, h: number): void {
  for (const hole of holesOf(mask, w, h)) {
    if (hole.length < SPECK) {
      for (const p of hole) mask[p] = 1;
    }
  }
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
 * Floods `mask` from `from` over the pixels `open` lets in, at most `steps`
 * rings away — 8-connected when `diagonal` is true, so a ring is a square, 4 when
 * false; a rule lets a diagonal step through only where it says so.
 */
function spread(
  mask: Uint8Array,
  w: number,
  h: number,
  from: readonly number[],
  open: (p: number) => boolean,
  steps: number,
  diagonal: boolean | CornerRule,
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
          if (!mask[q] && open(q)
            && (diagonal === true || dx === 0 || dy === 0 || (diagonal as CornerRule)(py * w + qx, qy * w + px))) {
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
 * The old fills (`contour`, what the bucket lays down) lying wholly in `area`:
 * the same area poured again, which the new fill replaces wherever they lay — a
 * refill is a new colour, not one more layer of paint. `scale`: raster pixels
 * per document unit.
 */
export function oldFillsIn(
  area: Uint8Array,
  w: number,
  h: number,
  strokes: readonly SlotStroke[],
  tools: readonly ToolDescriptor[],
  scale: number,
): number[] {
  const toArea = distanceField(w, h, (p) => area[p] === 1);
  // The same area traced again comes out a pixel or two off: a ring's
  // corners lie on pixel edges, and straightening moves them (a refill
  // measured on the owner's file reached 1.2 px past the new one).
  const within = (x: number, y: number) => {
    const px = Math.min(w - 1, Math.max(0, Math.floor(x * scale)));
    const py = Math.min(h - 1, Math.max(0, Math.floor(y * scale)));
    return toArea[py * w + px] <= 3;
  };
  const found: number[] = [];
  strokes.forEach((stroke, index) => {
    const tool = tools[stroke.tool_id];
    const path = tool?.kind === 'contour' ? flatten(stroke.points, tool.geometry, true) : [];
    // Its edge in the area is not enough: an area can be a ring round it, as a
    // line pressed on is round what it encloses.
    if (path.length > 0
      && path.every((v, i) => i % 2 === 1 || within(v, path[i + 1]))
      && everyPixelInside(path, scale, w, h, (p) => toArea[p] <= 3)) {
      found.push(index);
    }
  });
  return found;
}

/** The share of what was pressed a fill may miss and still be all of it: its edge rounds a pixel or so. */
const RECOLOUR_SLACK = 0.01;

/**
 * Which old fill the press is on, when the colour pressed is that one fill and
 * nothing more — it then only changes colour, its outline untouched: traced
 * again it would creep out over its own soft edge at every press. `found` is
 * what `oldFillsIn` found, `pure` what `pureOf` did.
 */
export function recolouredFill(
  pure: readonly number[],
  found: readonly number[],
  strokes: readonly SlotStroke[],
  tools: readonly ToolDescriptor[],
  scale: number,
  w: number,
  h: number,
): number | null {
  if (found.length !== 1) return null;
  const stroke = strokes[found[0]];
  const tool = tools[stroke.tool_id];
  if (tool?.kind !== 'contour' || tool.geometry !== 'line') return null;
  const inFill = new Uint8Array(w * h);
  everyPixelInside(flatten(stroke.points, tool.geometry, true), scale, w, h, (p) => {
    inFill[p] = 1;
    return true;
  });
  let missed = 0;
  for (const p of pure) missed += 1 - inFill[p];
  return missed <= pure.length * RECOLOUR_SLACK ? found[0] : null;
}

/** Whether `test` holds for every pixel of the sheet inside the closed polyline `path` (even–odd). */
function everyPixelInside(
  path: readonly number[],
  scale: number,
  w: number,
  h: number,
  test: (p: number) => boolean,
): boolean {
  const n = path.length / 2;
  for (let y = 0; y < h; y++) {
    const line = (y + 0.5) / scale;
    const crossings: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ay = path[i * 2 + 1];
      const by = path[j * 2 + 1];
      if ((ay > line) !== (by > line)) {
        crossings.push(path[i * 2] + ((line - ay) / (by - ay)) * (path[j * 2] - path[i * 2]));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let c = 0; c + 1 < crossings.length; c += 2) {
      const from = Math.max(0, Math.ceil(crossings[c] * scale - 0.5));
      const to = Math.min(w - 1, Math.floor(crossings[c + 1] * scale - 0.5));
      for (let x = from; x <= to; x++) {
        if (!test(y * w + x)) return false;
      }
    }
  }
  return true;
}

/**
 * The pixels of the area that are the colour pressed, give or take rounding:
 * what the fill has to be seen on. The soft edge of what borders the area is
 * not in it, or the fill would go over its own border to be seen there.
 */
export function pureOf(area: Uint8Array, distance: Uint8Array): number[] {
  const pure: number[] = [];
  for (let p = 0; p < area.length; p++) {
    if (area[p] && distance[p] <= 2) pure.push(p);
  }
  return pure;
}

/**
 * The slot of a stack of `count` strokes the fill goes in: the lowest one where
 * it is seen as much as on top of everything. `seenAt` answers on how many
 * pixels it is seen from a slot; a slot higher up is never seen on less, so this
 * bisects, and a stack of thousands is drawn a dozen times.
 */
export function lowestSeenSlot(count: number, seenAt: (slot: number) => number): number {
  const most = seenAt(count);
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (seenAt(middle) >= most) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
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


/** A side of a ring at most this long is a step of a staircase. */
const STEP = 2;
/** A side at most this long beside a step is a run of a shallow staircase, not a side of the shape. */
const RUN = 8;
/** How far straightening may move a smoothed edge, pixels. */
const SMOOTH_TOLERANCE = 0.6;

/**
 * A traced ring as an edge you would draw: a pixel staircase goes through the
 * middles of its steps, which lie on the true edge where its corners stand half
 * a pixel off, and is then straightened; a long side and the corners at its ends
 * stay where they are. A recoloured line shows this edge bare, with no line
 * over it to hide a wobble.
 */
export function smoothRing(ring: readonly number[]): number[] {
  const n = ring.length / 2;
  if (n < 4) return [...ring];
  const side = (i: number) => {
    const j = (i + 1) % n;
    return Math.hypot(ring[2 * j] - ring[2 * i], ring[2 * j + 1] - ring[2 * i + 1]);
  };
  const stair = (i: number) => side(i) <= STEP
    || (side(i) <= RUN && (side((i + n - 1) % n) <= STEP || side((i + 1) % n) <= STEP));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (!stair((i + n - 1) % n) || !stair(i)) {
      out.push(ring[2 * i], ring[2 * i + 1]);
    }
    if (stair(i)) {
      out.push((ring[2 * i] + ring[2 * j]) / 2, (ring[2 * i + 1] + ring[2 * j + 1]) / 2);
    }
  }
  return simplifyRing(out, SMOOTH_TOLERANCE);
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
