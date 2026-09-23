import { describe, expect, it } from 'bun:test';
import { flattenPressured, pressureAlong, pressureWidth, emitPressuredOutline } from './pressure';

describe('pressureWidth', () => {
  it('is the full width at full pressure and never vanishes at none', () => {
    expect(pressureWidth(100, 100)).toBe(100);
    expect(pressureWidth(100, 0)).toBeCloseTo(15);
  });
});

describe('flattenPressured', () => {
  it('reads a line point by point, pressure unchanged', () => {
    expect(flattenPressured([0, 0, 10, 0, 20, 0], [10, 50, 90], 'line')).toEqual([0, 0, 10, 10, 0, 50, 20, 0, 90]);
  });

  it('samples a curve and lands on its last point with the last pressure', () => {
    const flat = flattenPressured([0, 0, 0, 0, 40, 40, 80, 0, 80, 0], [0, 0, 50, 100, 100], 'smooth');
    expect(flat.length % 3).toBe(0);
    expect(flat.slice(0, 3)).toEqual([0, 0, 0]);
    expect(flat.slice(-3)).toEqual([80, 0, 100]);
    // Pressure only grows along the line, the way it was pressed.
    for (let i = 5; i < flat.length; i += 3) expect(flat[i]).toBeGreaterThanOrEqual(flat[i - 3]);
  });

  it('reads a cubic chain with the anchors carrying their own pressure', () => {
    const flat = flattenPressured([0, 0, 10, 0, 20, 0, 30, 0], [20, 0, 0, 80], 'cubic');
    expect(flat.slice(0, 3)).toEqual([0, 0, 20]);
    expect(flat.slice(-3)).toEqual([30, 0, 80]);
  });
});

describe('emitPressuredOutline', () => {
  it('lays a circle at every point and a quad between them, all wound the same way', () => {
    const log: string[] = [];
    const quads: number[][] = [];
    let current: number[] = [];
    const sink = {
      moveTo: (x: number, y: number) => { current = [x, y]; quads.push(current); log.push('m'); },
      lineTo: (x: number, y: number) => { current.push(x, y); log.push('l'); },
      arc: () => { quads.pop(); log.push('a'); },
    };
    emitPressuredOutline([0, 0, 0, 100, 0, 100, 100, 100, 50], 10, sink);
    expect(log.filter((c) => c === 'a')).toHaveLength(3);
    expect(quads).toHaveLength(2);
    for (const q of quads) {
      let area = 0;
      for (let i = 0; i < q.length; i += 2) {
        const j = (i + 2) % q.length;
        area += q[i] * q[j + 1] - q[j] * q[i + 1];
      }
      // Same sign as a canvas arc drawn clockwise: the union fills nonzero.
      expect(area).toBeGreaterThan(0);
    }
  });
});

describe('pressureAlong', () => {
  it('gives each kept point the pressure found at the same share of the line', () => {
    const samples = [0, 0, 0.1, 50, 0, 0.5, 100, 0, 1];
    expect(pressureAlong([0, 0, 100, 0], samples)).toEqual([10, 100]);
    expect(pressureAlong([0, 0, 50, 0, 100, 0], samples)).toEqual([10, 50, 100]);
  });

  it('takes the firmest press for a dot', () => {
    expect(pressureAlong([5, 5], [5, 5, 0.2, 5, 5, 0.7])).toEqual([70]);
  });
});
