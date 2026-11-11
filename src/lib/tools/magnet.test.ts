import { describe, expect, test } from 'bun:test';

import { MagnetSession, magnetStroke } from './magnet';

/** A pull from (0, 0) to (10, 0): radius 100, full strength, no densifying. */
const pull = { from: [0, 0] as const, to: [10, 0] as const, radius: 100, strength: 1, densify: false };

describe('magnetStroke', () => {
  test('a point under the centre travels with the cursor, times the strength', () => {
    expect(magnetStroke([0, 0], undefined, pull).points).toEqual([10, 0]);
    expect(magnetStroke([0, 0], undefined, { ...pull, strength: 0.5 }).points).toEqual([5, 0]);
  });

  test('the pull fades towards the edge of the circle, as (1 - (d/R)^2)^2', () => {
    // d = 50 of R = 100: (1 - 0.25)^2 = 0.5625 of 10.
    expect(magnetStroke([0, 50], undefined, pull).points).toEqual([5.625, 50]);
  });

  test('a point on or outside the circle stays, and the stroke says it did not move', () => {
    const out = magnetStroke([0, 100, 300, 0], undefined, pull);
    expect(out.points).toEqual([0, 100, 300, 0]);
    expect(out.moved).toBe(false);
  });

  test('a long segment through the circle is split first, so a straight line bends', () => {
    // A line of two points, both far outside R = 100, crossing under the centre.
    const out = magnetStroke([-400, 0, 400, 0], undefined, { ...pull, from: [0, 0], to: [0, 10], densify: true });
    const ys = out.points.filter((_, i) => i % 2 === 1);
    expect(out.points.length).toBeGreaterThan(4);
    expect(out.points.slice(0, 2)).toEqual([-400, 0]);
    expect(out.points.slice(-2)).toEqual([400, 0]);
    expect(Math.max(...ys)).toBeCloseTo(10, 0);
    // No piece under the circle longer than R / 4.
    for (let i = 2; i < out.points.length; i += 2) {
      const len = Math.hypot(out.points[i] - out.points[i - 2], out.points[i + 1] - out.points[i - 1]);
      if (Math.abs(out.points[i]) < 100) expect(len).toBeLessThanOrEqual(26);
    }
  });

  test('the points put in take the pressure between their ends', () => {
    const out = magnetStroke([-50, 300, 50, 300], [0, 100], { ...pull, from: [0, 300], to: [0, 300], densify: true });
    expect(out.pressure?.length).toBe(out.points.length / 2);
    expect(out.pressure?.[0]).toBe(0);
    expect(out.pressure?.at(-1)).toBe(100);
    const mid = out.points.findIndex((v, i) => i % 2 === 0 && v === 0) / 2;
    expect(out.pressure?.[mid]).toBe(50);
  });

  test('a segment that misses the circle is left whole, and without densify nothing is split', () => {
    expect(magnetStroke([-400, 300, 400, 300], undefined, { ...pull, densify: true }).points).toEqual([-400, 300, 400, 300]);
    expect(magnetStroke([-400, 0, 400, 0], undefined, pull).points).toEqual([-400, 0, 400, 0]);
  });

  test('returns a copy, so the snapshot behind it survives', () => {
    const points = [0, 0];
    magnetStroke(points, undefined, pull);
    expect(points).toEqual([0, 0]);
  });
});

describe('MagnetSession', () => {
  const smooth = { kind: 'pencil', geometry: 'smooth', width: 8, color: '#000000' } as const;
  const cell = (...strokes: number[][]) => ({ strokes: strokes.map((points) => ({ points, tool_id: 0 })) });
  const drag = { from: [0, 0], to: [0, 10], radius: 100, strength: 1 } as const;

  test('one drag moves the lines of every cell it was given — every selected layer', () => {
    const session = new MagnetSession([cell([0, 0, 400, 400]), cell([10, 0])], [smooth]);
    const next = session.drag(drag);
    expect(next?.[0][0].points.slice(0, 2)).toEqual([0, 10]);
    expect(next?.[1][0].points).toEqual([10, 10]);
  });

  test('a drag past every line is null: nothing to write, no step of undo', () => {
    const session = new MagnetSession([cell([500, 500, 600, 600])], [smooth]);
    expect(session.drag(drag)).toBeNull();
  });

  test('steps too small for a whole unit add up instead of being lost', () => {
    // A point at d = 50: each step passes on 0.5625 of 1 unit — truncated
    // alone it never moved.
    const session = new MagnetSession([cell([0, 50])], [smooth]);
    let points: number[] = [];
    for (let i = 0; i < 4; i++) {
      points = session.drag({ from: [0, 50 - 50], to: [1, 0], radius: 100, strength: 1 })?.[0][0].points ?? points;
    }
    expect(points).toEqual([2, 50]);
  });

  test('a pixel stroke is not split: two marks far outside stay put', () => {
    const stamp = { kind: 'stamp', geometry: 'line', width: 16, color: '#000000', shape: [0, 0] } as const;
    const session = new MagnetSession([cell([-400, 0, 400, 0])], [stamp]);
    expect(session.drag(drag)).toBeNull();
  });
});
