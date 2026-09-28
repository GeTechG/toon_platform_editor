/**
 * Pen pressure: how a stroke that carries it is read and drawn, and how the
 * pressure a pen reported lands on the points a brush kept.
 *
 * A pressured stroke is a line whose width changes along it, which a canvas
 * stroke cannot draw — so it is drawn as the union of a circle at every point
 * and a quad between neighbours, filled once. Every circle and quad is wound
 * the same way, so the nonzero fill is exactly their union: no overlap is
 * painted twice, and an eraser cuts it the same way.
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

/** What the outline is laid into — a canvas context satisfies it. */
export interface OutlineSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
}

/** The union of circles and quads over a flattened `[x, y, q, …]` line. */
export function emitPressuredOutline(flat: readonly number[], width: number, sink: OutlineSink): void {
  const radius = (i: number): number => pressureWidth(width, flat[i + 2]) / 2;
  for (let i = 0; i < flat.length; i += 3) {
    const r = radius(i);
    sink.moveTo(flat[i] + r, flat[i + 1]);
    sink.arc(flat[i], flat[i + 1], r, 0, Math.PI * 2);
  }
  for (let i = 3; i < flat.length; i += 3) {
    const ax = flat[i - 3];
    const ay = flat[i - 2];
    const bx = flat[i];
    const by = flat[i + 1];
    const length = Math.hypot(bx - ax, by - ay);
    if (length === 0) continue;
    const nx = -(by - ay) / length;
    const ny = (bx - ax) / length;
    const ra = radius(i - 3);
    const rb = radius(i);
    // The quad's corners, in scalars: this runs per segment per frame.
    const x0 = ax + nx * ra, y0 = ay + ny * ra;
    const x1 = bx + nx * rb, y1 = by + ny * rb;
    const x2 = bx - nx * rb, y2 = by - ny * rb;
    const x3 = ax - nx * ra, y3 = ay - ny * ra;
    // A canvas arc drawn clockwise has a positive shoelace area; a quad wound
    // the other way would cancel it under the nonzero rule.
    const area = (x0 * y1 - x1 * y0) + (x1 * y2 - x2 * y1) + (x2 * y3 - x3 * y2) + (x3 * y0 - x0 * y3);
    if (area > 0) {
      sink.moveTo(x0, y0);
      sink.lineTo(x1, y1);
      sink.lineTo(x2, y2);
      sink.lineTo(x3, y3);
    } else {
      sink.moveTo(x3, y3);
      sink.lineTo(x2, y2);
      sink.lineTo(x1, y1);
      sink.lineTo(x0, y0);
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
