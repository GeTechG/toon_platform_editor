import { describe, expect, test } from 'bun:test';

import {
  applyMatrix,
  bilinearWarp,
  clampCoord,
  pointInPolygon,
  transformMatrix,
} from './geom';

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

describe('pointInPolygon', () => {
  const square = [0, 0, 100, 0, 100, 100, 0, 100];

  test('a point inside is inside', () => {
    expect(pointInPolygon(50, 50, square)).toBe(true);
  });

  test('a point outside is outside', () => {
    expect(pointInPolygon(150, 50, square)).toBe(false);
    expect(pointInPolygon(50, -1, square)).toBe(false);
  });

  test('a concave polygon excludes its notch', () => {
    // A "C": the gap on the right side is outside despite the bounding box.
    const c = [0, 0, 100, 0, 100, 20, 20, 20, 20, 80, 100, 80, 100, 100, 0, 100];
    expect(pointInPolygon(60, 50, c)).toBe(false);
    expect(pointInPolygon(10, 50, c)).toBe(true);
  });

  test('a degenerate polygon contains nothing', () => {
    expect(pointInPolygon(0, 0, [0, 0, 1, 1])).toBe(false);
  });
});

describe('bilinearWarp', () => {
  const box = { x: 0, y: 0, width: 100, height: 100 };
  /** Corners in TL, TR, BR, BL order. */
  const identityQuad = [0, 0, 100, 0, 100, 100, 0, 100];

  test('an unmoved quad leaves points where they are', () => {
    const [x, y] = bilinearWarp(30, 70, box, identityQuad);
    expect(x).toBeCloseTo(30, 6);
    expect(y).toBeCloseTo(70, 6);
  });

  test('a dragged corner moves points near it and leaves the far one alone', () => {
    const quad = [0, 0, 100, 0, 100, 150, 0, 100];
    const [nearX, nearY] = bilinearWarp(100, 100, box, quad);
    expect(nearX).toBeCloseTo(100, 6);
    expect(nearY).toBeCloseTo(150, 6);
    const [farX, farY] = bilinearWarp(0, 0, box, quad);
    expect(farX).toBeCloseTo(0, 6);
    expect(farY).toBeCloseTo(0, 6);
  });

  test('the centre of the box lands at the centroid of the quad', () => {
    const quad = [10, 0, 100, 20, 90, 100, 0, 80];
    const [x, y] = bilinearWarp(50, 50, box, quad);
    expect(x).toBeCloseTo((10 + 100 + 90 + 0) / 4, 6);
    expect(y).toBeCloseTo((0 + 20 + 100 + 80) / 4, 6);
  });

  test('a zero-sized box maps everything to the first corner', () => {
    const [x, y] = bilinearWarp(5, 5, { x: 5, y: 5, width: 0, height: 0 }, identityQuad);
    expect(x).toBe(0);
    expect(y).toBe(0);
  });
});

describe('clampCoord', () => {
  test('rounds to whole document units', () => {
    expect(clampCoord(4.4)).toBe(4);
    expect(clampCoord(4.6)).toBe(5);
    expect(clampCoord(-4.6)).toBe(-5);
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
