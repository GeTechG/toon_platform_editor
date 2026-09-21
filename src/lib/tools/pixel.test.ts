import { describe, expect, it, test } from 'bun:test';
import { interpolatePixelLine, pixelCellNearest } from './pixel';

describe('interpolatePixelLine (Bresenham over cells)', () => {
  it('walks an axis-dominant line in whole cells, endpoints included', () => {
    expect(interpolatePixelLine(0, 0, 48, 0, 16)).toEqual([0, 0, 16, 0, 32, 0, 48, 0]);
  });

  it('walks a diagonal one cell at a time', () => {
    expect(interpolatePixelLine(0, 0, 32, 32, 16)).toEqual([0, 0, 16, 16, 32, 32]);
  });

  it('a y-dominant line steps along y', () => {
    expect(interpolatePixelLine(0, 0, 0, 32, 16)).toEqual([0, 0, 0, 16, 0, 32]);
  });
});

describe('pixelCellNearest', () => {
  test('snaps to the closest cell, so a whole row shifts by the same amount', () => {
    // A transform lands the row between cells with one common remainder.
    // Rounding down sends neighbours opposite ways and collapses cells;
    // rounding to the nearest moves every one of them by the same step.
    const row = [-10, 14, 38, 62, 86, 110];
    expect(row.map((v) => pixelCellNearest(v, 24))).toEqual([0, 24, 48, 72, 96, 120]);
  });

  test('is exact on a cell boundary and never yields -0', () => {
    expect(pixelCellNearest(24, 24)).toBe(24);
    expect(pixelCellNearest(-1, 24)).toBe(0);
  });
});
