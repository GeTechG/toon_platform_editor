import { describe, expect, it } from 'bun:test';
import { FIXED_POINT_SCALE } from '../lib/format/constants';
import { commitOldschoolStroke, oldschoolContour, oldschoolJitter } from './oldschool-geometry';

/** RNG that always lands mid-range: the jitter term (random·j − j/2) is 0. */
const midRandom = () => 0.5;

function roundAll(points: number[]): number[] {
  return points.map((v) => Math.round(v * 100) / 100 + 0);
}

describe('oldschoolJitter', () => {
  it('is half/2 clamped to 2..6 once the half width reaches 2, else 0 (DrawField.hx)', () => {
    expect(oldschoolJitter(0)).toBe(0);
    expect(oldschoolJitter(1)).toBe(0);
    expect(oldschoolJitter(2)).toBe(2);
    expect(oldschoolJitter(3)).toBe(2);
    expect(oldschoolJitter(8)).toBe(4);
    expect(oldschoolJitter(20)).toBe(6);
  });
});

describe('oldschoolContour', () => {
  it('a single point becomes an 8-point circle of the half width', () => {
    const contour = oldschoolContour([10, 20], 4, 2, midRandom);
    expect(contour).toHaveLength(16);
    for (let i = 0; i < 16; i += 2) {
      expect(Math.hypot(contour[i] - 10, contour[i + 1] - 20)).toBeCloseTo(4, 6);
    }
  });

  it('a straight segment becomes a capsule: 5-point start cap, 5-point end cap', () => {
    const contour = oldschoolContour([0, 0, 100, 0], 4, 2, midRandom);
    expect(roundAll(contour)).toEqual([
      0, 4, -2.83, 2.83, -4, 0, -2.83, -2.83, 0, -4,
      100, -4, 102.83, -2.83, 104, 0, 102.83, 2.83, 100, 4,
    ]);
  });

  it('a polyline of n points yields 2n+6 contour points hugging the line', () => {
    const line = [0, 0, 40, 5, 80, 0, 120, -20, 160, -30];
    const contour = oldschoolContour(line, 4, 2, midRandom);
    expect(contour).toHaveLength((2 * 5 + 6) * 2);
    for (let i = 0; i < contour.length; i += 2) {
      let nearest = Infinity;
      for (let j = 0; j < line.length; j += 2) {
        nearest = Math.min(nearest, Math.hypot(contour[i] - line[j], contour[i + 1] - line[j + 1]));
      }
      expect(nearest).toBeLessThanOrEqual(4 + 1e-9);
    }
  });

  it('jitter moves the radius by random·j − j/2 on gentle bends only', () => {
    const line = [0, 0, 50, 0, 100, 0];
    const wide = oldschoolContour(line, 4, 2, () => 1); // +1
    const narrow = oldschoolContour(line, 4, 2, () => 0); // −1
    // The middle point's side offsets (index 5 forward, index n-... backward).
    const midForward = 5 * 2;
    expect(Math.abs(wide[midForward + 1])).toBeCloseTo(5, 6);
    expect(Math.abs(narrow[midForward + 1])).toBeCloseTo(3, 6);
  });

  it('is deterministic for the same RNG sequence', () => {
    const seq = () => {
      let s = 1;
      return () => ((s = (s * 48271) % 2147483647) / 2147483647);
    };
    const line = [0, 0, 30, 10, 60, 0, 90, 15];
    expect(oldschoolContour(line, 5, 2, seq())).toEqual(oldschoolContour(line, 5, 2, seq()));
  });
});

describe('commitOldschoolStroke', () => {
  it('simplifies with Lang 5/5 logical px, offsets by trunc(size/2) and rounds to integers', () => {
    const s = FIXED_POINT_SCALE;
    // Raw points in document units, with a tiny wobble Lang (tolerance 5 px) removes.
    const raw = [0, 0, 20 * s, 1 * s, 40 * s, 0, 60 * s, -1 * s, 80 * s, 0, 100 * s, 0];
    const points = commitOldschoolStroke(raw, 9, midRandom);
    // size 9 → half 4 px = 32 units; straight capsule after simplification.
    expect(points).toEqual([
      0, 32, -23, 23, -32, 0, -23, -23, 0, -32,
      800, -32, 823, -23, 832, 0, 823, 23, 800, 32,
    ]);
    expect(points.every(Number.isInteger)).toBe(true);
  });

  it('a click without movement commits a circle', () => {
    const points = commitOldschoolStroke([80, 80], 4, midRandom);
    expect(points).toHaveLength(16);
  });
});
