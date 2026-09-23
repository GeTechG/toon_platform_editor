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
  type Command = (t: number) => [number, number];
  const commands: Command[] = [];
  let start: [number, number] = [points[0], points[1]];
  let px = points[0];
  let py = points[1];
  emitGeometry(points, geometry, false, {
    moveTo(x, y) {
      start = [x, y];
      px = x;
      py = y;
    },
    lineTo(x, y) {
      const [ax, ay] = [px, py];
      commands.push((t) => [ax + (x - ax) * t, ay + (y - ay) * t]);
      px = x;
      py = y;
    },
    quadraticCurveTo(cx, cy, x, y) {
      const [ax, ay] = [px, py];
      commands.push((t) => {
        const u = 1 - t;
        return [u * u * ax + 2 * u * t * cx + t * t * x, u * u * ay + 2 * u * t * cy + t * t * y];
      });
      px = x;
      py = y;
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      const [ax, ay] = [px, py];
      commands.push((t) => {
        const u = 1 - t;
        const a = u * u * u;
        const b = 3 * u * u * t;
        const c = 3 * u * t * t;
        const d = t * t * t;
        return [a * ax + b * c1x + c * c2x + d * x, a * ay + b * c1y + c * c2y + d * y];
      });
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
  const out = [start[0], start[1], pressure[0]];
  const count = commands.length;
  commands.forEach((command, k) => {
    const steps = geometry === 'line' ? 1 : CURVE_STEPS;
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const [x, y] = command(t);
      out.push(x, y, at(((k + t) / count) * last));
    }
  });
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
    const [ax, ay, bx, by] = [flat[i - 3], flat[i - 2], flat[i], flat[i + 1]];
    const length = Math.hypot(bx - ax, by - ay);
    if (length === 0) continue;
    const nx = -(by - ay) / length;
    const ny = (bx - ax) / length;
    const ra = radius(i - 3);
    const rb = radius(i);
    const quad = [
      ax + nx * ra, ay + ny * ra,
      bx + nx * rb, by + ny * rb,
      bx - nx * rb, by - ny * rb,
      ax - nx * ra, ay - ny * ra,
    ];
    // A canvas arc drawn clockwise has a positive shoelace area; a quad wound
    // the other way would cancel it under the nonzero rule.
    let area = 0;
    for (let j = 0; j < 8; j += 2) {
      const k = (j + 2) % 8;
      area += quad[j] * quad[k + 1] - quad[k] * quad[j + 1];
    }
    const order = area > 0 ? [0, 2, 4, 6] : [6, 4, 2, 0];
    sink.moveTo(quad[order[0]], quad[order[0] + 1]);
    for (let j = 1; j < 4; j++) sink.lineTo(quad[order[j]], quad[order[j] + 1]);
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
