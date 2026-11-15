import { describe, expect, it } from 'bun:test';
import { flattenPressured, pressureAlong, pressureWidth, emitPressuredOutline } from './pressure';

describe('pressureWidth', () => {
  it('is the full width at full pressure and never vanishes at none', () => {
    expect(pressureWidth(100, 100)).toBe(100);
    expect(pressureWidth(100, 0)).toBeCloseTo(15);
  });
});

describe('flattenPressured', () => {
  it('reads a line point by point, pressure unchanged', () => {
    expect(flattenPressured([0, 0, 10, 0, 20, 0], [10, 50, 90], 'line')).toEqual([0, 0, 10, 10, 0, 50, 20, 0, 90]);
  });

  it('samples a curve and lands on its last point with the last pressure', () => {
    const flat = flattenPressured([0, 0, 0, 0, 40, 40, 80, 0, 80, 0], [0, 0, 50, 100, 100], 'smooth');
    expect(flat.length % 3).toBe(0);
    expect(flat.slice(0, 3)).toEqual([0, 0, 0]);
    expect(flat.slice(-3)).toEqual([80, 0, 100]);
    // Pressure only grows along the line, the way it was pressed.
    for (let i = 5; i < flat.length; i += 3) expect(flat[i]).toBeGreaterThanOrEqual(flat[i - 3]);
  });

  it('reads a cubic chain with the anchors carrying their own pressure', () => {
    const flat = flattenPressured([0, 0, 10, 0, 20, 0, 30, 0], [20, 0, 0, 80], 'cubic');
    expect(flat.slice(0, 3)).toEqual([0, 0, 20]);
    expect(flat.slice(-3)).toEqual([30, 0, 80]);
  });
});

/**
 * What a canvas fills from the outline under the nonzero rule: the path is
 * replayed as canvas would (an arc joins the current point with a line,
 * every subpath closes), arcs cut fine, the winding counted by crossings.
 */
function filled(flat: readonly number[], width: number): { covers: (x: number, y: number) => boolean; subpaths: number } {
  const rings: number[][] = [];
  let ring: number[] = [];
  const sink = {
    moveTo(x: number, y: number) { ring = [x, y]; rings.push(ring); },
    lineTo(x: number, y: number) { ring.push(x, y); },
    arc(cx: number, cy: number, r: number, a0: number, a1: number, anticlockwise = false) {
      let sweep = a1 - a0;
      if (!anticlockwise && sweep < 0) sweep = (sweep % (2 * Math.PI)) + 2 * Math.PI;
      if (anticlockwise && sweep > 0) sweep = (sweep % (2 * Math.PI)) - 2 * Math.PI;
      if (Math.abs(a1 - a0) >= 2 * Math.PI) sweep = anticlockwise ? -2 * Math.PI : 2 * Math.PI;
      const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 128)));
      for (let k = 0; k <= steps; k++) {
        const a = a0 + (sweep * k) / steps;
        ring.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
      }
    },
    closePath() {},
  };
  emitPressuredOutline(flat, width, sink);
  const covers = (x: number, y: number): boolean => {
    let winding = 0;
    for (const r of rings) {
      for (let i = 0; i < r.length; i += 2) {
        const ax = r[i], ay = r[i + 1];
        const j = (i + 2) % r.length;
        const bx = r[j], by = r[j + 1];
        if (ay <= y && by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) winding++;
        else if (ay > y && by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) winding--;
      }
    }
    return winding !== 0;
  };
  return { covers, subpaths: rings.length };
}

/**
 * The line it must fill: within the pressed radius of a point, or of the line
 * between two points with the radius going from one to the other.
 */
function reach(flat: readonly number[], width: number, x: number, y: number): { inside: number; outside: number } {
  let inside = -Infinity;
  let outside = Infinity;
  const r = (i: number) => pressureWidth(width, flat[i + 2]) / 2;
  for (let i = 0; i < flat.length; i += 3) {
    const d = Math.hypot(x - flat[i], y - flat[i + 1]);
    inside = Math.max(inside, r(i) - d);
    outside = Math.min(outside, d - r(i));
    if (i + 3 >= flat.length) continue;
    const ax = flat[i], ay = flat[i + 1], bx = flat[i + 3], by = flat[i + 4];
    const length2 = (bx - ax) ** 2 + (by - ay) ** 2;
    if (length2 === 0) continue;
    const t = ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / length2;
    if (t < 0 || t > 1) continue;
    const ds = Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay)));
    inside = Math.max(inside, r(i) + t * (r(i + 3) - r(i)) - ds);
    outside = Math.min(outside, ds - Math.max(r(i), r(i + 3)));
  }
  return { inside, outside };
}

/** Every point of a grid well inside the line is filled, every one well off it is not. */
function expectFillsTheLine(flat: number[], width: number): void {
  const { covers } = filled(flat, width);
  const margin = Math.max(1, width * 0.06);
  const xs = flat.filter((_, i) => i % 3 === 0);
  const ys = flat.filter((_, i) => i % 3 === 1);
  const pad = width;
  const step = width / 9;
  const misses: string[] = [];
  for (let x = Math.min(...xs) - pad; x <= Math.max(...xs) + pad; x += step) {
    for (let y = Math.min(...ys) - pad; y <= Math.max(...ys) + pad; y += step) {
      const { inside, outside } = reach(flat, width, x, y);
      if (inside > margin && !covers(x, y)) misses.push(`hole at ${x.toFixed(1)},${y.toFixed(1)}`);
      if (outside > margin && covers(x, y)) misses.push(`spill at ${x.toFixed(1)},${y.toFixed(1)}`);
    }
  }
  expect(misses.slice(0, 5)).toEqual([]);
}

describe('emitPressuredOutline', () => {
  const W = 90;
  const cases: Record<string, number[]> = {
    'a straight line pressed harder to the end': [0, 0, 10, 100, 0, 50, 200, 0, 100],
    'a gentle curve': Array.from({ length: 24 }, (_, k) => {
      const a = (k / 23) * Math.PI;
      return [400 * Math.cos(a), 400 * Math.sin(a), 30 + 3 * k];
    }).flat(),
    'a right-angle turn': [0, 0, 60, 200, 0, 80, 200, 200, 60],
    'a sharp turn back at 20 degrees': [0, 0, 70, 300, 0, 90, 0, 104, 70],
    'a turn straight back on itself': [0, 0, 60, 300, 0, 90, 0, 0, 60],
    'a turn straight back going up': [0, 300, 60, 0, 300, 90, 0, 0, 90, 0, 300, 60],
    'a turn straight back going left on a slant': [300, 300, 60, 0, 0, 90, 300, 300, 60],
    'a turn back short of the start': [0, 0, 60, 300, 0, 90, 150, 0, 40],
    'hatching back and forth': [0, 0, 50, 300, 10, 80, 20, 20, 60, 310, 30, 90, 10, 40, 40, 300, 50, 70],
    'a dot': [50, 50, 70],
    'a point said twice': [50, 50, 70, 50, 50, 70],
    'repeated points along the way': [0, 0, 50, 100, 0, 60, 100, 0, 60, 200, 50, 80, 200, 50, 80],
    'a press that jumps between close points': [0, 0, 0, 10, 0, 100, 20, 0, 0, 30, 0, 100, 200, 0, 0],
    'a sharp turn on a press that jumps': [0, 0, 0, 10, 0, 100, 0, 10, 0],
    'a tight loop': Array.from({ length: 33 }, (_, k) => {
      const a = (k / 32) * 2.2 * Math.PI;
      return [60 * Math.cos(a) + k * 4, 60 * Math.sin(a), 60];
    }).flat(),
  };
  for (const [name, flat] of Object.entries(cases)) {
    it(`fills ${name}, no hole and no spill`, () => expectFillsTheLine(flat, W));
  }

  it('fills any line with any press, no hole and no spill', () => {
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let run = 0; run < 300; run++) {
      const span = random() < 0.5 ? 30 : 300;
      const flat: number[] = [];
      for (let n = 2 + Math.floor(random() * 7); n > 0; n--) {
        flat.push(Math.round(random() * span), Math.round(random() * span), Math.round(random() * 100));
      }
      expectFillsTheLine(flat, W);
    }
  });

  it('lays a stroke as one contour, not a circle at every point', () => {
    const flat = Array.from({ length: 40 }, (_, k) => [k * 10, Math.sin(k / 4) * 50, 50]).flat();
    expect(filled(flat, W).subpaths).toBe(1);
  });
});

describe('pressureAlong', () => {
  it('gives each kept point the pressure found at the same share of the line', () => {
    const samples = [0, 0, 0.1, 50, 0, 0.5, 100, 0, 1];
    expect(pressureAlong([0, 0, 100, 0], samples)).toEqual([10, 100]);
    expect(pressureAlong([0, 0, 50, 0, 100, 0], samples)).toEqual([10, 50, 100]);
  });

  it('takes the firmest press for a dot', () => {
    expect(pressureAlong([5, 5], [5, 5, 0.2, 5, 5, 0.7])).toEqual([70]);
  });
});
