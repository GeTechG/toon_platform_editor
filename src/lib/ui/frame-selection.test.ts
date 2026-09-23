import { describe, expect, it } from 'bun:test';
import {
  activeFrameAfterRemove,
  cursorShape,
  activeLayerAfterMove,
  activeLayerAfterRemove,
  clampPlayerFps,
  dragTargetIndex,
  keepsSelection,
  newLayerIndex,
  pasteTargetFromSelection,
  pickSource,
  onionHistoryLayers,
  onionLayers,
  onionSkinVisible,
  playbackRange,
  pushVisited,
  shiftVisited,
  wrapIndex,
  playbackStartFrame,
  rangeSelection,
  toggleLayerInSelection,
  extendTarget,
  frameMenuKey,
  selectionSpan,
} from './frame-selection';
import type { CellSelection } from './frame-selection';

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
  it('hides while the pipette is up, so it reads the drawing and not the ghosts', () => {
    expect(onionSkinVisible(true, false, 'pipette')).toBe(false);
    expect(onionSkinVisible(true, false, 'pencil')).toBe(true);
  });

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

describe('onionHistoryLayers', () => {
  it('drops the active frame and keeps the ladder of the full history (Tonio)', () => {
    // visited 5 → 2 → 7, now editing 2: alpha = 0.15 / 3 * (i + 1) over the
    // *unfiltered* history, so the freshest visit stays at 0.15.
    // The ladder keeps the reference's own expression, float artifacts included.
    expect(onionHistoryLayers([5, 2, 7], 2, 10)).toEqual([
      { index: 5, alpha: (0.15 / 3) * 1 },
      { index: 7, alpha: (0.15 / 3) * 3 },
    ]);
  });

  it('a single visited frame gets the full 0.15', () => {
    expect(onionHistoryLayers([4], 0, 10)).toEqual([{ index: 4, alpha: 0.15 }]);
  });

  it('an empty history draws nothing', () => {
    expect(onionHistoryLayers([], 0, 10)).toEqual([]);
  });

  it('skips frames the document no longer has', () => {
    expect(onionHistoryLayers([12], 0, 10)).toEqual([]);
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

  it('honors the profile range (Tonio: 1–30)', () => {
    expect(clampPlayerFps(30, [1, 30])).toBe(30);
    expect(clampPlayerFps(1, [1, 30])).toBe(1);
    expect(clampPlayerFps(0.4, [1, 30])).toBe(1);
    expect(clampPlayerFps(31, [1, 30])).toBe(30);
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


describe('rangeSelection', () => {
  const BOUNDS = { frames: 8, layers: 4 };

  it('spans every frame and layer between the anchor and the target', () => {
    expect(rangeSelection({ frame: 1, layer: 0 }, { frame: 4, layer: 2 }, BOUNDS)).toEqual({
      frames: [1, 2, 3, 4],
      layers: [0, 1, 2],
    });
  });

  it('reads the same in either direction', () => {
    expect(rangeSelection({ frame: 4, layer: 2 }, { frame: 1, layer: 0 }, BOUNDS)).toEqual({
      frames: [1, 2, 3, 4],
      layers: [0, 1, 2],
    });
  });

  it('a target outside the document is clamped to its edge', () => {
    expect(rangeSelection({ frame: 6, layer: 3 }, { frame: 99, layer: 99 }, BOUNDS)).toEqual({
      frames: [6, 7],
      layers: [3],
    });
    expect(rangeSelection({ frame: 1, layer: 1 }, { frame: -5, layer: -5 }, BOUNDS)).toEqual({
      frames: [0, 1],
      layers: [0, 1],
    });
  });

  it('the anchor alone is a one-cell selection', () => {
    expect(rangeSelection({ frame: 2, layer: 1 }, { frame: 2, layer: 1 }, BOUNDS)).toEqual({
      frames: [2],
      layers: [1],
    });
  });
});

describe('toggleLayerInSelection', () => {
  it('adds a layer, keeping the list ascending', () => {
    const selection = { frames: [3], layers: [2] };
    expect(toggleLayerInSelection(selection, { frame: 3, layer: 0 }, 2)).toEqual({
      frames: [3],
      layers: [0, 2],
    });
  });

  it('removes a layer that was in the selection', () => {
    const selection = { frames: [3], layers: [0, 1, 2] };
    expect(toggleLayerInSelection(selection, { frame: 3, layer: 1 }, 2)).toEqual({
      frames: [3],
      layers: [0, 2],
    });
  });

  it('refuses to empty the selection', () => {
    const selection = { frames: [3], layers: [1] };
    expect(toggleLayerInSelection(selection, { frame: 3, layer: 1 }, 0)).toEqual({
      frames: [3],
      layers: [1],
    });
  });

  it('declines a frame outside the selection — the caller plain-clicks it', () => {
    const selection = { frames: [3, 4], layers: [1] };
    expect(toggleLayerInSelection(selection, { frame: 7, layer: 0 }, 1)).toBeNull();
  });

  it('declines the active layer — Ctrl must not drop the row you draw on', () => {
    const selection = { frames: [3], layers: [0, 1] };
    expect(toggleLayerInSelection(selection, { frame: 3, layer: 1 }, 1)).toBeNull();
  });
});

describe('cursorShape', () => {
  it('drops the ring for a thin brush and shows the cross instead', () => {
    expect(cursorShape(2, true)).toEqual({ ring: false, cross: true });
    expect(cursorShape(3, true)).toEqual({ ring: false, cross: true });
  });

  it('keeps the ring alone between the two thresholds', () => {
    for (const cross of [true, false]) {
      expect(cursorShape(4, cross)).toEqual({ ring: true, cross: false });
      expect(cursorShape(24, cross)).toEqual({ ring: true, cross: false });
    }
  });

  it('crosses a thick brush whether or not the setting is on', () => {
    expect(cursorShape(25, false)).toEqual({ ring: true, cross: true });
    expect(cursorShape(25, true)).toEqual({ ring: true, cross: true });
  });

  it('a thin brush without the setting is a plain ring', () => {
    expect(cursorShape(2, false)).toEqual({ ring: true, cross: false });
    expect(cursorShape(3, false)).toEqual({ ring: true, cross: false });
  });
});

describe('keepsSelection', () => {
  const selection: CellSelection = { frames: [2, 3, 4], layers: [1, 3] };

  it('keeps a multi-cell selection when the new active cell is inside it', () => {
    expect(keepsSelection(selection, { frame: 3, layer: 3 })).toBe(true);
  });

  it('keeps it on the edge of the block', () => {
    expect(keepsSelection(selection, { frame: 2, layer: 1 })).toBe(true);
    expect(keepsSelection(selection, { frame: 4, layer: 3 })).toBe(true);
  });

  it('collapses it when the frame steps outside', () => {
    expect(keepsSelection(selection, { frame: 5, layer: 3 })).toBe(false);
  });

  it('collapses it when the layer steps outside — a gap counts as outside', () => {
    expect(keepsSelection(selection, { frame: 3, layer: 2 })).toBe(false);
  });
});


describe('pasteTargetFromSelection', () => {
  it('a single selected cell takes a single-cell buffer — the plain paste', () => {
    expect(pasteTargetFromSelection({ frames: [3], layers: [1] }, { frames: 1, layers: 1 }))
      .toEqual({ frames: [3], layers: [1] });
  });

  it('fills every selected frame, however few the buffer holds', () => {
    expect(pasteTargetFromSelection({ frames: [5, 6, 7, 8, 9], layers: [0] }, { frames: 2, layers: 1 }))
      .toEqual({ frames: [5, 6, 7, 8, 9], layers: [0] });
  });

  it('takes the topmost rows when the selection has more layers than the buffer', () => {
    expect(pasteTargetFromSelection({ frames: [2], layers: [0, 1, 2, 3] }, { frames: 1, layers: 2 }))
      .toEqual({ frames: [2], layers: [2, 3] });
  });

  it('a buffer with more layers than the selection targets the selection as it is', () => {
    expect(pasteTargetFromSelection({ frames: [2], layers: [1, 2] }, { frames: 1, layers: 5 }))
      .toEqual({ frames: [2], layers: [1, 2] });
  });

  it('keeps the gaps of a Ctrl-built layer selection', () => {
    expect(pasteTargetFromSelection({ frames: [0], layers: [0, 3, 5] }, { frames: 1, layers: 2 }))
      .toEqual({ frames: [0], layers: [3, 5] });
  });

  it('targets nothing when the buffer holds no layer', () => {
    expect(pasteTargetFromSelection({ frames: [0, 1], layers: [0, 1] }, { frames: 0, layers: 0 }))
      .toEqual({ frames: [0, 1], layers: [] });
  });
});

describe('playbackRange', () => {
  const selectionUx = { playbackRange: 'selection', playFromStart: false } as const;
  const documentUx = { playbackRange: 'document', playFromStart: false } as const;
  const multatorUx = { playbackRange: 'document', playFromStart: true } as const;
  const one = (frame: number) => ({ frames: [frame], layers: [0] });

  it('Toonio: Space plays the whole document from the first frame', () => {
    expect(playbackRange(3, one(3), 9, selectionUx, false)).toEqual({ start: 0, end: 8, first: 0 });
  });

  it('Toonio: a multi-frame selection plays only itself, from its start', () => {
    expect(playbackRange(5, { frames: [3, 4, 5], layers: [0] }, 9, selectionUx, false)).toEqual({
      start: 3,
      end: 5,
      first: 3,
    });
  });

  it('Toonio: Shift+Space starts at the active frame inside the same range', () => {
    expect(playbackRange(5, { frames: [3, 4, 5], layers: [0] }, 9, selectionUx, true)).toEqual({
      start: 3,
      end: 5,
      first: 5,
    });
  });

  it('Toonio: Shift+Space without a selection starts at the active frame', () => {
    expect(playbackRange(3, one(3), 9, selectionUx, true)).toEqual({ start: 0, end: 8, first: 3 });
  });

  it('Toonio: a one-frame document does not play at all', () => {
    expect(playbackRange(0, one(0), 1, selectionUx, false)).toBeNull();
  });

  it('Toonio: a gappy selection still plays the stretch it spans', () => {
    expect(playbackRange(2, { frames: [2, 7], layers: [0] }, 9, selectionUx, false)).toEqual({
      start: 2,
      end: 7,
      first: 2,
    });
  });

  it('Toonop: the whole document from the active frame, selection or not', () => {
    expect(playbackRange(3, { frames: [5, 6], layers: [0] }, 9, documentUx, false)).toEqual({
      start: 0,
      end: 8,
      first: 3,
    });
  });

  it('Multator: the whole document from the first frame', () => {
    expect(playbackRange(3, one(3), 9, multatorUx, false)).toEqual({ start: 0, end: 8, first: 0 });
  });

  it('Multator: Shift still starts at the active frame', () => {
    expect(playbackRange(3, one(3), 9, multatorUx, true)).toEqual({ start: 0, end: 8, first: 3 });
  });

  it('Toonop: a one-frame document still plays — only Toonio refuses', () => {
    expect(playbackRange(0, one(0), 1, documentUx, false)).toEqual({ start: 0, end: 0, first: 0 });
  });
});

describe('pushVisited', () => {
  it('records the frame that was left, not the one arrived at', () => {
    expect(pushVisited([], 0, 4)).toEqual([0]);
  });

  it('walking 1 → 2 → 3 → 4 → 5 leaves the three ghosts behind the cursor', () => {
    let history: number[] = [];
    for (const [from, to] of [[0, 1], [1, 2], [2, 3], [3, 4]]) {
      history = pushVisited(history, from, to);
    }
    expect(history).toEqual([1, 2, 3]);
    const ghosts = onionHistoryLayers(history, 4, 5);
    expect(ghosts.map((g) => g.index)).toEqual([1, 2, 3]);
    expect(ghosts.map((g) => Number(g.alpha.toFixed(2)))).toEqual([0.05, 0.1, 0.15]);
  });

  it('keeps only the last three visits', () => {
    expect(pushVisited([1, 2, 3], 4, 7)).toEqual([2, 3, 4]);
  });

  it('ignores a move that lands where it started', () => {
    expect(pushVisited([1, 2], 2, 2)).toEqual([1, 2]);
  });

  it('a hop out and back keeps both ends in the history', () => {
    // Opened on 1, visited 5, 2 and 7, then back to 2 (one-based).
    let history: number[] = [];
    for (const [from, to] of [[1, 5], [5, 2], [2, 7], [7, 2]]) {
      history = pushVisited(history, from, to);
    }
    expect(history).toEqual([5, 2, 7]);
    const ghosts = onionHistoryLayers(history, 2, 9);
    expect(ghosts.map((g) => g.index)).toEqual([5, 7]);
    expect(ghosts.map((g) => Number(g.alpha.toFixed(2)))).toEqual([0.05, 0.15]);
  });
});

describe('shiftVisited', () => {
  it('moves the frames an insertion pushed along', () => {
    expect(shiftVisited([2, 3], 2)).toEqual([3, 4]);
  });

  it('leaves the frames before the insertion where they are', () => {
    expect(shiftVisited([0, 1, 5], 2)).toEqual([0, 1, 6]);
  });

  it('an empty history survives an insertion', () => {
    expect(shiftVisited([], 0)).toEqual([]);
  });
});

describe('wrapIndex', () => {
  it('walks forward inside the list', () => {
    expect(wrapIndex(1, 4)).toBe(1);
    expect(wrapIndex(3, 4)).toBe(3);
  });

  it('wraps past the end round to the start', () => {
    expect(wrapIndex(4, 4)).toBe(0);
    expect(wrapIndex(5, 4)).toBe(1);
  });

  it('wraps before the start round to the end', () => {
    expect(wrapIndex(-1, 4)).toBe(3);
    expect(wrapIndex(-5, 4)).toBe(3);
  });

  it('a one-item list stays put', () => {
    expect(wrapIndex(-1, 1)).toBe(0);
    expect(wrapIndex(1, 1)).toBe(0);
  });
});

describe('newLayerIndex', () => {
  it('Toonio drops the new layer right under the active one', () => {
    expect(newLayerIndex(2, 'below', false)).toBe(2);
  });

  it('Ctrl flips it to above', () => {
    expect(newLayerIndex(2, 'below', true)).toBe(3);
  });

  it('the other presets stack upward, and Ctrl flips them down', () => {
    expect(newLayerIndex(2, 'above', false)).toBe(3);
    expect(newLayerIndex(2, 'above', true)).toBe(2);
  });
});

describe('pushVisited without a landing frame', () => {
  it('records the frame that was left even when the index stays put', () => {
    // Inserting a frame in front of the active one keeps the index but puts a
    // *different* cell under it, so there is nothing to compare against — the
    // reference pushes unconditionally on that path (`AddHistory(prev, ctrl)`).
    expect(pushVisited([1], 2)).toEqual([1, 2]);
  });

  it('still keeps only the last three', () => {
    expect(pushVisited([1, 2, 3], 4)).toEqual([2, 3, 4]);
  });
});

describe('ninth audit: Shift+arrow grows the block a step at a time', () => {
  // The target was always the active cell's neighbour, and the active cell is
  // the anchor: a second Shift+← spanned the same two frames again, so a
  // keyboard could never select more than two frames or two layers.
  const bounds = { frames: 10, layers: 4 };

  it('each press moves the far edge, not the anchor', () => {
    const active = { frame: 5, layer: 1 };
    let sel: CellSelection = { frames: [5], layers: [1] };
    sel = rangeSelection(active, extendTarget(sel, active, -1, 0, bounds), bounds);
    sel = rangeSelection(active, extendTarget(sel, active, -1, 0, bounds), bounds);
    expect(sel.frames).toEqual([3, 4, 5]);
    sel = rangeSelection(active, extendTarget(sel, active, 0, 1, bounds), bounds);
    sel = rangeSelection(active, extendTarget(sel, active, 0, 1, bounds), bounds);
    expect(sel.layers).toEqual([1, 2, 3]);
  });

  it('the opposite arrow shrinks back towards the anchor and past it', () => {
    const active = { frame: 5, layer: 0 };
    const sel = { frames: [3, 4, 5], layers: [0] };
    expect(extendTarget(sel, active, 1, 0, bounds)).toEqual({ frame: 4, layer: 0 });
    expect(extendTarget({ frames: [5], layers: [0] }, active, 1, 0, bounds)).toEqual({ frame: 6, layer: 0 });
  });

  it('stops at the edges instead of wrapping', () => {
    const active = { frame: 0, layer: 3 };
    expect(extendTarget({ frames: [0], layers: [3] }, active, -1, 1, bounds)).toEqual({ frame: 0, layer: 3 });
  });
});

describe('frameMenuKey', () => {
  it('shows the letter while the letter keys are on', () => {
    expect(frameMenuKey('copy', true, false)).toEqual({ aria: 'C', label: 'C' });
    expect(frameMenuKey('add', true, false)).toEqual({ aria: 'A', label: 'A' });
  });

  it('with the letter keys off shows the key that still works, never a bare letter', () => {
    expect(frameMenuKey('add', false, false)).toEqual({ aria: 'F7', label: 'F7' });
    expect(frameMenuKey('copy', false, false)).toEqual({ aria: 'Control+C', label: 'Ctrl+C' });
    expect(frameMenuKey('paste', false, false)).toEqual({ aria: 'Control+V', label: 'Ctrl+V' });
    expect(frameMenuKey('merge', false, false)).toEqual({ aria: 'Control+M', label: 'Ctrl+M' });
  });

  it('Delete is not a letter: the setting leaves it alone', () => {
    expect(frameMenuKey('delete', false, false)).toEqual({ aria: 'Delete', label: 'Del' });
    expect(frameMenuKey('delete', true, false)).toEqual({ aria: 'Delete', label: 'Del' });
  });

  it('merge has no key where M opens the palette (Multator)', () => {
    expect(frameMenuKey('merge', true, true)).toBeNull();
    expect(frameMenuKey('merge', false, true)).toBeNull();
  });
});

describe('selectionSpan', () => {
  it('reads the block as 1-based first and last frame and a layer count', () => {
    expect(selectionSpan({ frames: [4, 2, 3], layers: [0, 1] })).toEqual({ from: 3, to: 5, layers: 2 });
  });
});
