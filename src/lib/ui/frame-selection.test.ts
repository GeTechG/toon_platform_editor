import { describe, expect, it } from 'bun:test';
import {
  activeFrameAfterRemove,
  clampPlayerFps,
  onionLayers,
  onionSkinVisible,
} from './frame-selection';

const ALPHAS = [0.3, 0.1];

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

describe('onionLayers', () => {
  it('a deep-enough middle frame gets both sides at every depth, farthest first', () => {
    expect(onionLayers(2, 5, ALPHAS)).toEqual([
      { index: 0, alpha: 0.1 },
      { index: 4, alpha: 0.1 },
      { index: 1, alpha: 0.3 },
      { index: 3, alpha: 0.3 },
    ]);
  });

  it('the first frame shows only the next neighbors, fading with distance', () => {
    expect(onionLayers(0, 3, ALPHAS)).toEqual([
      { index: 2, alpha: 0.1 },
      { index: 1, alpha: 0.3 },
    ]);
  });

  it('the last frame shows only the previous neighbors', () => {
    expect(onionLayers(2, 3, ALPHAS)).toEqual([
      { index: 0, alpha: 0.1 },
      { index: 1, alpha: 0.3 },
    ]);
  });

  it('a single frame has no onion layers', () => {
    expect(onionLayers(0, 1, ALPHAS)).toEqual([]);
  });

  it('clamps to the available neighbors near an edge', () => {
    // active=1 of 3: depth-2 falls outside on both sides, only depth-1 remains.
    expect(onionLayers(1, 3, ALPHAS)).toEqual([
      { index: 0, alpha: 0.3 },
      { index: 2, alpha: 0.3 },
    ]);
  });
});

describe('onionSkinVisible', () => {
  it('shows when enabled and not playing', () => {
    expect(onionSkinVisible(true, false)).toBe(true);
  });

  it('is hidden during playback regardless of the toggle', () => {
    expect(onionSkinVisible(true, true)).toBe(false);
    expect(onionSkinVisible(false, true)).toBe(false);
  });

  it('is hidden when disabled', () => {
    expect(onionSkinVisible(false, false)).toBe(false);
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
