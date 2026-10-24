import { describe, expect, it } from 'bun:test';
import { filmTiming } from './timing';

describe('время мульта в тактах', () => {
  it('без длительностей кадр — такт', () => {
    const t = filmTiming(undefined, 3);
    expect(t.total).toBe(3);
    expect([0, 1, 2].map((f) => t.start(f))).toEqual([0, 1, 2]);
    expect([0, 1, 2].map((tick) => t.frameAt(tick))).toEqual([0, 1, 2]);
  });

  it('кадр держится свои такты', () => {
    // Кадр 1 — три такта: такты 0 | 1 2 3 | 4 4.
    const t = filmTiming([1, 3, 2], 3);
    expect(t.total).toBe(6);
    expect([0, 1, 2, 3].map((f) => t.start(f))).toEqual([0, 1, 4, 6]);
    expect([0, 1, 2, 3, 4, 5].map((tick) => t.frameAt(tick))).toEqual([0, 1, 1, 1, 2, 2]);
  });

  it('такт за краем — крайний кадр', () => {
    const t = filmTiming([2, 2], 2);
    expect(t.frameAt(-1)).toBe(0);
    expect(t.frameAt(99)).toBe(1);
  });
});
