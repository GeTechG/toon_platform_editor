import { describe, expect, it } from 'bun:test';
import { activeFrameAfterRemove, clampPlayerFps } from './frame-selection';

describe('activeFrameAfterRemove', () => {
  it('the neighbor (same index) becomes active after a removal', () => {
    expect(activeFrameAfterRemove(1, 3)).toBe(1);
    expect(activeFrameAfterRemove(0, 2)).toBe(0);
  });

  it('after removing the last frame the new last one is active', () => {
    expect(activeFrameAfterRemove(2, 2)).toBe(1);
    expect(activeFrameAfterRemove(0, 1)).toBe(0); // the only frame was cleared
  });
});

describe('clampPlayerFps', () => {
  it('keeps fps within the 12–24 player range', () => {
    expect(clampPlayerFps(5)).toBe(12);
    expect(clampPlayerFps(12)).toBe(12);
    expect(clampPlayerFps(18.4)).toBe(18);
    expect(clampPlayerFps(24)).toBe(24);
    expect(clampPlayerFps(60)).toBe(24);
    expect(clampPlayerFps(Number.NaN)).toBe(12);
  });
});
