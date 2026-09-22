import { describe, expect, it } from 'bun:test';
import { MULTATOR_RULES, MULTATOR_SCALE } from './multator';

describe('the Multator brush carries its own rules', () => {
  it('carries the reference numbers brought to the editor\'s canvas', () => {
    // The reference measured on a 600-wide canvas; the editor draws on 1280.
    expect(MULTATOR_SCALE).toBe(1280 / 600);
    expect(MULTATOR_RULES.range).toEqual({ min: 1, max: 640 });
    expect(MULTATOR_RULES.defaults?.width).toBe(9);
    expect('canvas' in MULTATOR_RULES).toBe(false);
  });

  it('collects one point per event, repeats and all', () => {
    const first = MULTATOR_RULES.capture([], [10, 20], 32);
    expect(first).toEqual([10, 20]);
    // A repeat is kept: the reference pushes every move as it comes, and a
    // trailing repeat changes both the Lang window and the last curve segment.
    // The rule returns what the event adds, so the same point comes again.
    expect(MULTATOR_RULES.capture(first, [10, 20], 32)).toEqual([10, 20]);
  });

  it('takes the event itself out of a coalesced batch, never the whole batch', () => {
    // The reference reads one mousemove at a time; the samples the browser
    // held back between frames were never part of its line.
    expect(MULTATOR_RULES.capture([], [1, 1, 2, 2, 3, 3], 32)).toEqual([3, 3]);
  });

  it('thins with Lang and stores whole coordinates, keeping the ends', () => {
    const line: number[] = [];
    for (let i = 0; i <= 20; i++) line.push(i * 8, Math.sin(i) * 0.4);
    const prepared = MULTATOR_RULES.prepare!(line, 32, 1);
    expect(prepared.length).toBeLessThan(line.length);
    expect(prepared.slice(0, 2)).toEqual([0, 0]);
    expect(prepared.slice(-2)).toEqual([160, Math.round(Math.sin(20) * 0.4)]);
    expect(prepared.every(Number.isInteger)).toBe(true);
  });

  it('lays its points down as they are: they already are the curve', () => {
    expect(MULTATOR_RULES.path).toBeUndefined();
  });

  it('loses a cancelled gesture instead of landing it', () => {
    expect(MULTATOR_RULES.commitOnCancel).toBeFalsy();
  });

  it('leaves a gesture that never moved as a dot', () => {
    // The release adds nothing where the hand let go, and its point where it moved.
    expect(MULTATOR_RULES.release!([10, 20], [10, 20], 32)).toEqual([]);
    expect(MULTATOR_RULES.release!([10, 20], [30, 40], 32)).toEqual([30, 40]);
  });
});
