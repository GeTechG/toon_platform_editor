import { describe, expect, test } from 'bun:test';

import { applyMatrix, clampCoord, transformMatrix } from './geom';

const CENTRE = { cx: 100, cy: 100 };

describe('transformMatrix', () => {
  test('identity leaves a point where it is', () => {
    const m = transformMatrix({}, CENTRE.cx, CENTRE.cy);
    expect(applyMatrix(m, 42, 7)).toEqual([42, 7]);
  });

  test('translation shifts every point by the same offset', () => {
    const m = transformMatrix({ dx: 10, dy: -5 }, CENTRE.cx, CENTRE.cy);
    expect(applyMatrix(m, 0, 0)).toEqual([10, -5]);
    expect(applyMatrix(m, 200, 200)).toEqual([210, 195]);
  });

  test('rotation turns about the given centre, not the origin', () => {
    const m = transformMatrix({ rotate: 90 }, CENTRE.cx, CENTRE.cy);
    const [x, y] = applyMatrix(m, 150, 100);
    expect(x).toBeCloseTo(100, 6);
    expect(y).toBeCloseTo(150, 6);
    const [ox, oy] = applyMatrix(m, 100, 100);
    expect(ox).toBeCloseTo(100, 6);
    expect(oy).toBeCloseTo(100, 6);
  });

  test('scale grows the distance from the centre per axis', () => {
    const m = transformMatrix({ scaleX: 2, scaleY: 0.5 }, CENTRE.cx, CENTRE.cy);
    expect(applyMatrix(m, 150, 200)).toEqual([200, 150]);
  });

  test('a negative scale is the mirror', () => {
    const m = transformMatrix({ scaleX: -1 }, CENTRE.cx, CENTRE.cy);
    expect(applyMatrix(m, 130, 40)).toEqual([70, 40]);
  });

  test('rotation applies before the translation', () => {
    const m = transformMatrix({ rotate: 180, dx: 20 }, CENTRE.cx, CENTRE.cy);
    const [x, y] = applyMatrix(m, 150, 100);
    expect(x).toBeCloseTo(70, 6);
    expect(y).toBeCloseTo(100, 6);
  });
});

describe('clampCoord', () => {
  test('truncates to whole document units, the way the reference does', () => {
    expect(clampCoord(4.4)).toBe(4);
    expect(clampCoord(4.6)).toBe(4);
    expect(clampCoord(-4.6)).toBe(-4);
  });

  test('clamps to the int16 range the format stores', () => {
    expect(clampCoord(1e9)).toBe(32767);
    expect(clampCoord(-1e9)).toBe(-32768);
  });

  test('a non-finite coordinate becomes zero rather than NaN in the document', () => {
    expect(clampCoord(Number.NaN)).toBe(0);
    expect(clampCoord(Number.POSITIVE_INFINITY)).toBe(32767);
  });
});
