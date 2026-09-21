import { describe, expect, it } from 'bun:test';

import { laySmoothPoints } from '../render/smoothing';
import { toonopRules } from './brush';

/**
 * The editor's own brush. What it does is written down here and nowhere else:
 * a parity fix in the shipped plugin must not be able to move this line.
 */
describe('the editor brush', () => {
  const rules = toonopRules({ width: 5, color: '#000000', fill: '#ffffff', smooth: 3, minDistance: 3 });

  it('measures its numbers on the editor\'s logical canvas', () => {
    expect(rules.range).toEqual({ min: 1, max: 500 });
    expect(rules.defaults).toEqual({ width: 5, smooth: 3, minDistance: 3 });
  });

  it('truncates a sample to whole logical pixels as it collects it', () => {
    expect(rules.capture([], [10.9, 20.9], 40)).toEqual([8, 16]);
  });

  it('drops a repeat inside one batch but keeps one across two', () => {
    expect(rules.capture([], [8, 8, 8, 8, 16, 16], 40)).toEqual([8, 8, 16, 16]);
    expect(rules.capture([8, 8], [8, 8], 40)).toEqual([8, 8, 8, 8]);
  });

  it('shows the first thinning stage under the hand and both on commit', () => {
    const line = [0, 0, 8, 0, 16, 0, 24, 0, 32, 0, 40, 0, 48, 0];
    const live = rules.preview!(line);
    const committed = rules.prepare!(line, 40, 1, 1);

    expect(live.length).toBeLessThan(line.length);
    expect(committed.length).toBeLessThanOrEqual(live.length);
    for (const out of [live, committed]) {
      expect(out.slice(-4)).toEqual([48, 0, 48, 0]);
    }
  });

  it('thins by the knobs it is handed, not by numbers of its own', () => {
    const line = [0, 0, 8, 0, 16, 0, 24, 0, 32, 0, 40, 0, 48, 0];
    const dense = toonopRules({ width: 5, color: '#000', fill: '#fff', smooth: 1, minDistance: 0 });

    expect(dense.prepare!(line, 40, 1, 1).length).toBeGreaterThan(rules.prepare!(line, 40, 1, 1).length);
  });

  it('lands a cancelled gesture rather than throwing it away', () => {
    expect(rules.commitOnCancel).toBe(true);
  });

  it('lays its points down for the smooth reader', () => {
    expect(rules.path).toBe(laySmoothPoints);
  });

  it('carries the slider range and the defaults of its canvas', () => {
    expect(rules.range).toEqual({ min: 1, max: 500 });
    expect(rules.defaults).toEqual({ width: 5, smooth: 3, minDistance: 3 });
    expect(rules.smoothing).toBe(true);
  });

  it('says the same about its ranges whatever brush it is handed', () => {
    const other = toonopRules({ width: 400, color: '#fff', fill: '#000', smooth: 99, minDistance: 30 });

    expect(other.range).toEqual(rules.range!);
    expect(other.defaults).toEqual(rules.defaults!);
  });
});

describe('laying points down for the smooth reader', () => {
  it('repeats the first point, so the curve starts with its control on it', () => {
    expect(laySmoothPoints([10, 10, 40, 80, 40, 80])).toEqual([10, 10, 10, 10, 40, 80, 40, 80]);
  });

  it('leaves a line too short to curve alone', () => {
    expect(laySmoothPoints([])).toEqual([]);
    expect(laySmoothPoints([5])).toEqual([5]);
  });
});
