import { describe, expect, test } from 'bun:test';

import { distortRate, jitter } from './distort';

describe('distortRate', () => {
  test('is the whole hundreds of horizontal travel (reference ~~((x - x0) / 100))', () => {
    expect(distortRate(250, 0)).toBe(2);
    expect(distortRate(0, -100)).toBe(1);
  });

  test('a drag shorter than a hundred has no strength at all', () => {
    expect(distortRate(60, 0)).toBe(0);
    expect(distortRate(-99, 0)).toBe(0);
  });
});

describe('jitter', () => {
  test('shifts every coordinate by ~~((random - 0.5) * rate)', () => {
    expect(jitter([10, 20, 30, 40], 4, () => 1)).toEqual([12, 22, 32, 42]);
    expect(jitter([10, 20], 4, () => 0)).toEqual([8, 18]);
  });

  test('rate 0 leaves the points exactly where they were', () => {
    expect(jitter([10, 20, 30, 40], 0, () => 1)).toEqual([10, 20, 30, 40]);
  });

  test('returns a copy, so the snapshot behind it survives', () => {
    const points = [1, 2];
    jitter(points, 10, () => 1);
    expect(points).toEqual([1, 2]);
  });
});
