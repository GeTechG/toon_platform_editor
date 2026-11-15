import { describe, expect, it } from 'bun:test';

import { PathKeeper, pathCost } from './path-keeper';

const tool = { kind: 'pencil', geometry: 'smooth', width: 8, color: '#000000' } as const;

describe('PathKeeper', () => {
  it('builds a stroke once and hands the same paths back', () => {
    const keeper = new PathKeeper<object>(1 << 20);
    const points = [1, 2, 3, 4];
    let built = 0;
    const build = () => (built++, {});
    const first = keeper.take(points, tool, undefined, build);
    expect(keeper.take(points, tool, undefined, build)).toBe(first);
    expect(built).toBe(1);
  });

  it('keeps nothing with no budget: the player draws each frame once', () => {
    const keeper = new PathKeeper<object>(0);
    const points = [1, 2, 3, 4];
    let built = 0;
    keeper.take(points, tool, undefined, () => (built++, {}));
    keeper.take(points, tool, undefined, () => (built++, {}));
    expect(built).toBe(2);
    expect(keeper.bytes).toBe(0);
  });

  it('lets the longest unused go first once past its budget', () => {
    const a = [0, 0, 1, 1];
    const b = [0, 0, 2, 2];
    const c = [0, 0, 3, 3];
    const keeper = new PathKeeper<object>(pathCost(a) * 2);
    const built: number[][] = [];
    const take = (points: number[]) => keeper.take(points, tool, undefined, () => (built.push(points), {}));
    take(a);
    take(b);
    take(a); // a used again: b is now the longest unused
    take(c);
    expect(keeper.bytes).toBeLessThanOrEqual(pathCost(a) * 2);
    built.length = 0;
    take(a);
    take(c);
    expect(built).toEqual([]);
    take(b);
    expect(built).toEqual([b]);
  });

  it('a stroke heavier than the whole budget is drawn, not kept', () => {
    const big = Array.from({ length: 2000 }, (_, i) => i);
    const keeper = new PathKeeper<object>(pathCost([0, 0]) * 2);
    let built = 0;
    keeper.take(big, tool, undefined, () => (built++, {}));
    keeper.take(big, tool, undefined, () => (built++, {}));
    expect(built).toBe(2);
    expect(keeper.bytes).toBe(0);
  });

  it('a pressured stroke counts as heavier than a plain one of as many points', () => {
    const points = [0, 0, 5, 5, 9, 9];
    expect(pathCost(points, [10, 20, 30])).toBeGreaterThan(pathCost(points));
  });

  it('another tool or pressure on the same points is a path of its own', () => {
    const keeper = new PathKeeper<object>(1 << 20);
    const points = [1, 2, 3, 4];
    const plain = keeper.take(points, tool, undefined, () => ({}));
    const pressured = keeper.take(points, tool, [5, 6], () => ({}));
    const wider = keeper.take(points, { ...tool, width: 9 }, undefined, () => ({}));
    expect(pressured).not.toBe(plain);
    expect(wider).not.toBe(plain);
    expect(keeper.take(points, tool, undefined, () => ({}))).toBe(plain);
  });
});
