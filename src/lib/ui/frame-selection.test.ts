import { describe, expect, it } from 'bun:test';
import {
  activeFrameAfterRemove,
  activeLayerAfterMove,
  activeLayerAfterRemove,
  clampPlayerFps,
  dragTargetIndex,
  pickSource,
  onionLayers,
  onionSkinVisible,
  playbackStartFrame,
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

  it("'previous' prefers the frame before the removed one (Multator)", () => {
    expect(activeFrameAfterRemove(2, 4, 'previous')).toBe(1);
    expect(activeFrameAfterRemove(3, 3, 'previous')).toBe(2);
  });

  it("'previous' stays on the first frame when there is nothing before it", () => {
    expect(activeFrameAfterRemove(0, 2, 'previous')).toBe(0);
    expect(activeFrameAfterRemove(0, 1, 'previous')).toBe(0);
  });
});

describe('playbackStartFrame', () => {
  it('starts from the active frame by default', () => {
    expect(playbackStartFrame(2, false)).toBe(2);
  });

  it('starts from the first frame when the profile plays from start', () => {
    expect(playbackStartFrame(2, true)).toBe(0);
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

  it("'previous' shows only the frames before the active one (Multator)", () => {
    expect(onionLayers(2, 5, ALPHAS, 'previous')).toEqual([
      { index: 0, alpha: 0.1 },
      { index: 1, alpha: 0.3 },
    ]);
    expect(onionLayers(0, 5, ALPHAS, 'previous')).toEqual([]);
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
    expect(clampPlayerFps(1)).toBe(5);
    expect(clampPlayerFps(5)).toBe(5);
    expect(clampPlayerFps(12)).toBe(12);
    expect(clampPlayerFps(18.4)).toBe(18);
    expect(clampPlayerFps(24)).toBe(24);
    expect(clampPlayerFps(60)).toBe(24);
    expect(clampPlayerFps(Number.NaN)).toBe(5);
  });
});

describe('activeLayerAfterRemove', () => {
  it('keeps the position when the removed layer was the active one', () => {
    // [0 1 2], remove 1 → the layer above takes position 1 and stays active
    expect(activeLayerAfterRemove(1, 1, 2)).toBe(1);
  });

  it('falls back to the lower neighbor when the top layer was removed', () => {
    expect(activeLayerAfterRemove(2, 2, 2)).toBe(1);
  });

  it('shifts down when a layer below the active one was removed', () => {
    expect(activeLayerAfterRemove(2, 0, 2)).toBe(1);
  });

  it('is unchanged when a layer above the active one was removed', () => {
    expect(activeLayerAfterRemove(0, 2, 2)).toBe(0);
  });
});

describe('activeLayerAfterMove', () => {
  it('follows the moved layer', () => {
    expect(activeLayerAfterMove(0, 0, 2)).toBe(2);
    expect(activeLayerAfterMove(2, 2, 0)).toBe(0);
  });

  it('tracks the layers the move shifts past', () => {
    expect(activeLayerAfterMove(1, 0, 2)).toBe(0);
    expect(activeLayerAfterMove(2, 0, 2)).toBe(1);
    expect(activeLayerAfterMove(0, 2, 0)).toBe(1);
  });

  it('leaves layers outside the moved range alone', () => {
    expect(activeLayerAfterMove(3, 0, 2)).toBe(3);
    expect(activeLayerAfterMove(0, 1, 2)).toBe(0);
  });
});

describe('dragTargetIndex', () => {
  it('converts pointer travel into whole rows', () => {
    expect(dragTargetIndex(1, 0, 40, 4)).toBe(1);
    expect(dragTargetIndex(1, 41, 40, 4)).toBe(2);
    expect(dragTargetIndex(1, -41, 40, 4)).toBe(0);
  });

  it('rounds to the nearest row', () => {
    expect(dragTargetIndex(0, 19, 40, 4)).toBe(0);
    expect(dragTargetIndex(0, 21, 40, 4)).toBe(1);
  });

  it('clamps to the list bounds', () => {
    expect(dragTargetIndex(3, 400, 40, 4)).toBe(3);
    expect(dragTargetIndex(0, -400, 40, 4)).toBe(0);
  });
});

describe('pickSource', () => {
  it('uses the configured source', () => {
    expect(pickSource('canvas', false)).toBe('canvas');
    expect(pickSource('layer', false)).toBe('layer');
  });

  it('Alt takes the active layer for this click only', () => {
    expect(pickSource('canvas', true)).toBe('layer');
    expect(pickSource('layer', true)).toBe('layer');
  });
});
