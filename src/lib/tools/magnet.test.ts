import { describe, expect, test } from 'bun:test';

import { MagnetSession } from './magnet';

const smooth = { kind: 'pencil', geometry: 'smooth', width: 8, color: '#000000' } as const;
const stamp = { kind: 'stamp', geometry: 'line', width: 16, color: '#000000', shape: [0, 0] } as const;
const cell = (...strokes: number[][]) => ({ strokes: strokes.map((points) => ({ points, tool_id: 0 })) });

/** Pressed at (0, 0), radius 100, full strength. */
function session(cells: ReturnType<typeof cell>[], tools: readonly (typeof smooth | typeof stamp)[] = [smooth]) {
  const s = new MagnetSession(cells, tools);
  s.grab([0, 0], 100, 1);
  return s;
}

describe('MagnetSession', () => {
  test('a point grabbed under the centre follows the cursor, times the strength', () => {
    expect(session([cell([0, 0])]).drag([30, 0])?.[0][0].points).toEqual([30, 0]);
    const half = new MagnetSession([cell([0, 0])], [smooth]);
    half.grab([0, 0], 100, 0.5);
    expect(half.drag([30, 0])?.[0][0].points).toEqual([15, 0]);
  });

  test('a grabbed point keeps the weight of where it was pressed: (1 - (d/R)^2)^2', () => {
    // d = 50 of R = 100: 0.5625 of the cursor's travel, however far it goes.
    const s = session([cell([0, 50])]);
    expect(s.drag([16, 0])?.[0][0].points).toEqual([9, 50]);
    expect(s.drag([160, 0])?.[0][0].points).toEqual([90, 50]);
  });

  test('the travel is from the press, not summed move by move: back to the press is back in place', () => {
    const s = session([cell([0, 0])]);
    s.drag([40, 0]);
    s.drag([80, 0]);
    expect(s.drag([0, 0])?.[0][0].points).toEqual([0, 0]);
  });

  test('a point the circle reaches on the way is not taken', () => {
    // Outside the circle at the press; the cursor then passes right over it.
    const next = session([cell([0, 0]), cell([200, 0])]).drag([200, 0]);
    expect(next?.[0][0].points).toEqual([200, 0]);
    expect(next?.[1][0].points).toEqual([200, 0]);
  });

  test('every cell it was given is grabbed — every selected layer', () => {
    const next = session([cell([10, 0]), cell([0, 10])]).drag([0, 20]);
    expect(next?.[0][0].points).toEqual([10, 20]);
    expect(next?.[1][0].points).toEqual([0, 30]);
  });

  test('a press that took no point is null on every move: nothing to write, no step of undo', () => {
    expect(session([cell([500, 500, 600, 600])]).drag([50, 50])).toBeNull();
  });

  test('a long segment through the circle is split on the press, so a straight line bends', () => {
    const points = session([cell([-400, 0, 400, 0])]).drag([0, 10])?.[0][0].points ?? [];
    expect(points.length).toBeGreaterThan(4);
    expect(points.slice(0, 2)).toEqual([-400, 0]);
    expect(points.slice(-2)).toEqual([400, 0]);
    expect(Math.max(...points.filter((_, i) => i % 2 === 1))).toBe(10);
  });

  test('the points put in take the pressure between their ends', () => {
    const s = new MagnetSession([{ strokes: [{ points: [-50, 0, 50, 0], tool_id: 0, pressure: [0, 100] }] }], [smooth]);
    s.grab([0, 0], 100, 1);
    const stroke = s.drag([0, 1])?.[0][0];
    expect(stroke?.pressure?.length).toBe((stroke?.points.length ?? 0) / 2);
    expect(stroke?.pressure?.[0]).toBe(0);
    expect(stroke?.pressure?.at(-1)).toBe(100);
    const mid = (stroke?.points.findIndex((v, i) => i % 2 === 0 && v === 0) ?? 0) / 2;
    expect(stroke?.pressure?.[mid]).toBe(50);
  });

  test('a pixel stroke is not split: two marks far outside stay put', () => {
    expect(session([cell([-400, 0, 400, 0])], [stamp]).drag([0, 10])).toBeNull();
  });

  test('the snapshot it was built from is never written to', () => {
    const points = [0, 0];
    session([cell(points)]).drag([30, 0]);
    expect(points).toEqual([0, 0]);
  });
});
