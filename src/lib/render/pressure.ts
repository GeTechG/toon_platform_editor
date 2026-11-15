/**
 * Pen pressure: how a stroke that carries it is read and drawn, and how the
 * pressure a pen reported lands on the points a brush kept.
 *
 * A pressured stroke is a line whose width changes along it, which a canvas
 * stroke cannot draw — so it is drawn as its outline, one closed contour,
 * filled once under the nonzero rule. Until 2026-11-16 it was the union of a
 * circle at every flattened point and a quad between neighbours: the same
 * shape, but the circles cost 70% of a heavy frame (555 ms against 78 ms for
 * 2037 strokes without a GPU) — every editor looked at draws one contour.
 */

import { emitGeometry, type StrokeGeometry } from './smoothing';

/** Stored pressure runs 0..PRESSURE_MAX, whole numbers. */
export const PRESSURE_MAX = 100;

/** The line's width at stored pressure `q`: never thinner than 15% of the tool's. */
export function pressureWidth(width: number, q: number): number {
  return width * (0.15 + (0.85 * q) / PRESSURE_MAX);
}

/** Samples per curve command; a line command is its own two ends. */
const CURVE_STEPS = 8;

/**
 * The stroke's path as a polyline `[x, y, q, …]`, with the pressure at every
 * vertex. Command `k` of `M` covers the same share of the stored points, so a
 * line reads its pressures exactly and a cubic chain's anchors keep their own.
 */
export function flattenPressured(
  points: readonly number[],
  pressure: readonly number[],
  geometry: StrokeGeometry,
): number[] {
  // A pen's line under the hand is flattened whole every frame, so the
  // commands are kept as numbers — kind, start, controls, end — rather than a
  // closure per command and a pair per sample for the collector.
  const LINE = 0;
  const QUAD = 1;
  const CUBIC = 2;
  const commands: number[] = [];
  let startX = points[0];
  let startY = points[1];
  let px = points[0];
  let py = points[1];
  emitGeometry(points, geometry, false, {
    moveTo(x, y) {
      startX = x;
      startY = y;
      px = x;
      py = y;
    },
    lineTo(x, y) {
      commands.push(LINE, px, py, 0, 0, 0, 0, x, y);
      px = x;
      py = y;
    },
    quadraticCurveTo(cx, cy, x, y) {
      commands.push(QUAD, px, py, cx, cy, 0, 0, x, y);
      px = x;
      py = y;
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      commands.push(CUBIC, px, py, c1x, c1y, c2x, c2y, x, y);
      px = x;
      py = y;
    },
  });
  const last = pressure.length - 1;
  const at = (s: number): number => {
    const i = Math.min(last, Math.max(0, Math.floor(s)));
    const next = Math.min(last, i + 1);
    return pressure[i] + (pressure[next] - pressure[i]) * (s - i);
  };
  const out = [startX, startY, pressure[0]];
  const count = commands.length / 9;
  const steps = geometry === 'line' ? 1 : CURVE_STEPS;
  for (let k = 0; k < count; k++) {
    const o = k * 9;
    const kind = commands[o];
    const ax = commands[o + 1];
    const ay = commands[o + 2];
    const c1x = commands[o + 3];
    const c1y = commands[o + 4];
    const c2x = commands[o + 5];
    const c2y = commands[o + 6];
    const x = commands[o + 7];
    const y = commands[o + 8];
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const u = 1 - t;
      let sx: number;
      let sy: number;
      if (kind === LINE) {
        sx = ax + (x - ax) * t;
        sy = ay + (y - ay) * t;
      } else if (kind === QUAD) {
        sx = u * u * ax + 2 * u * t * c1x + t * t * x;
        sy = u * u * ay + 2 * u * t * c1y + t * t * y;
      } else {
        const a = u * u * u;
        const b = 3 * u * u * t;
        const c = 3 * u * t * t;
        const d = t * t * t;
        sx = a * ax + b * c1x + c * c2x + d * x;
        sy = a * ay + b * c1y + c * c2y + d * y;
      }
      out.push(sx, sy, at(((k + t) / count) * last));
    }
  }
  return out;
}

/** What the outline is laid into — a canvas context or a `Path2D` satisfies it. */
export interface OutlineSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, anticlockwise?: boolean): void;
}

/** Below this turn (radians) a join is a mitre point, past it a round one. */
const ROUND_TURN = 0.2;

/**
 * A press falling faster than this share of the step leaves the circle of the
 * firmer point sticking out past the line's sides: it gets a circle of its own.
 */
const STEEP_PRESS = 0.25;

/** Closer than this (document units) two points are one: no direction between them. */
const SAME_POINT = 1;

/**
 * The outline of a flattened `[x, y, q, …]` line as one closed contour: the
 * left side forward, the right side back, a half circle round each end.
 *
 * Where the line turns sharply the outer side goes round on an arc and the
 * inner side through the point itself, as Skia's own stroker does: the little
 * loops that leaves are wound the same way as the rest and the nonzero fill
 * counts them twice, never cuts them out. Straight from one edge to the next
 * instead, a firm point between two light ones turned the loop inside out and
 * it cancelled the point's own circle — a hole. A turn straight back
 * (hatching) goes round on a half circle like an end.
 */
export function emitPressuredOutline(flat: readonly number[], width: number, sink: OutlineSink): void {
  const xs: number[] = [];
  const ys: number[] = [];
  const rs: number[] = [];
  for (let i = 0; i < flat.length; i += 3) {
    const r = pressureWidth(width, flat[i + 2]) / 2;
    const n = xs.length;
    if (n > 0 && Math.hypot(flat[i] - xs[n - 1], flat[i + 1] - ys[n - 1]) < SAME_POINT) {
      rs[n - 1] = Math.max(rs[n - 1], r);
      continue;
    }
    xs.push(flat[i]);
    ys.push(flat[i + 1]);
    rs.push(r);
  }
  const n = xs.length;
  if (n === 1) {
    sink.moveTo(xs[0] + rs[0], ys[0]);
    sink.arc(xs[0], ys[0], rs[0], 0, Math.PI * 2, true);
    return;
  }
  const dx: number[] = [];
  const dy: number[] = [];
  const lengths: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const ex = xs[i + 1] - xs[i];
    const ey = ys[i + 1] - ys[i];
    const length = Math.hypot(ex, ey);
    dx.push(ex / length);
    dy.push(ey / length);
    lengths.push(length);
  }
  // `side` 1 is the left normal (-dy, dx), walked forward; -1 the right, walked back.
  const join = (i: number, side: 1 | -1): void => {
    const r = rs[i];
    const ax = dx[i - 1], ay = dy[i - 1], bx = dx[i], by = dy[i];
    const cross = ax * by - ay * bx;
    const turn = Math.atan2(Math.abs(cross), ax * bx + ay * by);
    // The normals in the order this side meets them.
    const [px, py, qx, qy] = side === 1
      ? [-ay, ax, -by, bx]
      : [by, -bx, ay, -ax];
    // Straight back has no side to turn to: the left one takes the arc.
    const outer = side === 1 ? cross <= 0 : cross > 0;
    if (turn > ROUND_TURN) {
      sink.lineTo(xs[i] + px * r, ys[i] + py * r);
      if (!outer) {
        sink.lineTo(xs[i], ys[i]);
        sink.lineTo(xs[i] + qx * r, ys[i] + qy * r);
        return;
      }
      const from = Math.atan2(py, px);
      let sweep = Math.atan2(qy, qx) - from;
      if (sweep > Math.PI) sweep -= 2 * Math.PI;
      if (sweep < -Math.PI) sweep += 2 * Math.PI;
      // Round the outside, the way the line was going: near straight back the
      // short way and the long way are the same length.
      if (Math.cos(from + sweep / 2 - Math.atan2(ay - by, ax - bx)) < 0) {
        sweep -= Math.sign(sweep) * 2 * Math.PI;
      }
      sink.arc(xs[i], ys[i], r, from, from + sweep, sweep < 0);
      return;
    }
    // A gentle turn: the point where both sides' edges meet.
    let mx = px + qx;
    let my = py + qy;
    const ml = Math.hypot(mx, my);
    mx /= ml;
    my /= ml;
    const k = r / (mx * px + my * py);
    sink.lineTo(xs[i] + mx * k, ys[i] + my * k);
  };
  const start = Math.atan2(dx[0], -dy[0]);
  sink.moveTo(xs[0] - dy[0] * rs[0], ys[0] + dx[0] * rs[0]);
  for (let i = 1; i < n - 1; i++) join(i, 1);
  const e = n - 1;
  const end = Math.atan2(dx[e - 1], -dy[e - 1]);
  sink.lineTo(xs[e] - dy[e - 1] * rs[e], ys[e] + dx[e - 1] * rs[e]);
  sink.arc(xs[e], ys[e], rs[e], end, end - Math.PI, true);
  for (let i = n - 2; i >= 1; i--) join(i, -1);
  sink.lineTo(xs[0] + dy[0] * rs[0], ys[0] - dx[0] * rs[0]);
  sink.arc(xs[0], ys[0], rs[0], start - Math.PI, start - 2 * Math.PI, true);
  // A point much firmer than a close neighbour: its circle, wound like the contour.
  for (let i = 0; i < n; i++) {
    const before = i > 0 ? (rs[i] - rs[i - 1]) / lengths[i - 1] : 0;
    const after = i < n - 1 ? (rs[i] - rs[i + 1]) / lengths[i] : 0;
    if (before > STEEP_PRESS || after > STEEP_PRESS) {
      sink.moveTo(xs[i] + rs[i], ys[i]);
      sink.arc(xs[i], ys[i], rs[i], 0, Math.PI * 2, true);
    }
  }
}

function cumulative(values: readonly number[], stride: number): number[] {
  const lengths = [0];
  for (let i = stride; i < values.length; i += stride) {
    lengths.push(lengths[lengths.length - 1]
      + Math.hypot(values[i] - values[i - stride], values[i + 1] - values[i - stride + 1]));
  }
  return lengths;
}

/**
 * The pressure at each kept point, from the pen's raw `[x, y, p(0..1), …]`.
 *
 * A brush thins, smooths and relays its points by its own rules, so a kept
 * point cannot say which sample it came from. It is given the pressure found
 * at the same share of the line's length instead: linear, monotone, and blind
 * to a line crossing itself. A line with no length — a dot — takes the firmest
 * press of the gesture.
 */
export function pressureAlong(points: readonly number[], samples: readonly number[]): number[] {
  const quantize = (p: number): number => Math.min(PRESSURE_MAX, Math.max(0, Math.round(p * PRESSURE_MAX)));
  const kept = cumulative(points, 2);
  const raw = cumulative(samples, 3);
  const keptLength = kept[kept.length - 1];
  const rawLength = raw[raw.length - 1];
  if (keptLength === 0 || rawLength === 0) {
    let firmest = 0;
    for (let i = 2; i < samples.length; i += 3) firmest = Math.max(firmest, samples[i]);
    return kept.map(() => quantize(firmest));
  }
  let j = 0;
  return kept.map((length) => {
    const target = (length / keptLength) * rawLength;
    while (j < raw.length - 2 && raw[j + 1] < target) j++;
    const span = raw[j + 1] - raw[j];
    const t = span > 0 ? Math.min(1, Math.max(0, (target - raw[j]) / span)) : 0;
    const a = samples[3 * j + 2];
    const b = samples[3 * Math.min(j + 1, raw.length - 1) + 2];
    return quantize(a + (b - a) * t);
  });
}
