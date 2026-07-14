import { describe, expect, it } from 'bun:test';
import { simplifyLang } from './simplify';

describe('simplifyLang', () => {
  it('leaves one- and two-point input untouched', () => {
    expect(simplifyLang([1, 2], 5, 10)).toEqual([1, 2]);
    expect(simplifyLang([1, 2, 3, 4], 5, 10)).toEqual([1, 2, 3, 4]);
  });

  it('is deterministic: same input — same output', () => {
    const points = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? i * 3 : Math.sin(i) * 40 + 50));
    expect(simplifyLang(points, 5, 10)).toEqual(simplifyLang(points, 5, 10));
  });

  it('preserves the first and last points', () => {
    const points: number[] = [];
    for (let i = 0; i <= 50; i++) {
      points.push(i * 7, 100 + Math.sin(i / 3) * 30);
    }
    const out = simplifyLang(points, 5, 10);
    expect(out.slice(0, 2)).toEqual(points.slice(0, 2));
    expect(out.slice(-2)).toEqual(points.slice(-2));
  });

  it('substantially compresses a dense near-straight line', () => {
    const points: number[] = [];
    for (let i = 0; i <= 100; i++) {
      points.push(i * 5, 50 + (i % 3)); // noise < tolerance
    }
    const out = simplifyLang(points, 5, 10);
    expect(out.length).toBeLessThan(points.length / 3);
    expect(out.slice(0, 2)).toEqual([0, 50]);
    expect(out.slice(-2)).toEqual([500, 50 + (100 % 3)]);
  });

  it('keeps corners: the corner point survives', () => {
    // L-shaped line: horizontal to (100,0), then vertical to (100,100).
    const points = [0, 0, 25, 0, 50, 0, 75, 0, 100, 0, 100, 25, 100, 50, 100, 75, 100, 100];
    const out = simplifyLang(points, 5, 10);
    expect(out).toEqual([0, 0, 100, 0, 100, 100]);
  });
});
