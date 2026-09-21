import { describe, expect, it } from 'bun:test';
import { t } from '../i18n';

// EditorState is a runes class, so its contract is asserted as source — the
// selection math it leans on is tested for real in frame-selection.test.ts
// and operations.test.ts.
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();

/** The class member's definition — anchored to the class-body indent so a call site does not match. */
function member(source: string, name: string): string {
  const match = source.match(new RegExp(`\\n  (private )?(get )?${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

describe('timeline selection state', () => {
  it('holds the selection as frame and layer index lists', () => {
    expect(state).toContain('selection = $state<CellSelection>');
  });

  it('a plain click collapses the selection onto the clicked cell', () => {
    const select = member(state, 'selectCell');
    expect(select).toContain('this.activeFrame');
    expect(select).toContain('this.activeLayer');
    expect(select).toContain('rangeSelection(');
    expect(select).toContain('toggleLayerInSelection(');
  });

  it('moving the active cell with the arrows drops the range', () => {
    expect(member(state, 'selectFrame')).toContain('this.selection =');
    expect(member(state, 'selectLayer')).toContain('this.selection =');
  });
});

describe('copy, paste and merge of a selection', () => {
  it('copy deep-copies every selected cell into the buffer', () => {
    expect(state).toContain('copiedCells = $state<CellBuffer | null>(null)');
    expect(member(state, 'copySelection')).toContain('copyCells(this.doc, this.selection)');
  });

  it('paste replaces the target cells and merge adds to them', () => {
    expect(member(state, 'pasteSelection')).toContain('replaceCells');
    expect(member(state, 'mergeSelection')).toContain('mergeCells');
  });

  it('both land the buffer on the selection, not beside the active cell', () => {
    const shared = member(state, 'applyCopiedCells');
    expect(shared).toContain('pasteTargetFromSelection(this.selection');
    expect(shared).toContain('this.copiedCells');
  });

  it('both are one undo step: the cells they overwrote go on the edit stack', () => {
    expect(member(state, 'applyCopiedCells')).toContain('this.pushEdit(');
    // The snapshot stack holds a list of cells per entry, so a block edit and
    // a mega-eraser cut both come back in one undo.
    expect(state).toContain('edits = $state<CellSnapshot[][]>([])');
    expect(member(state, 'undo')).toContain('this.restorableEdit');
    expect(member(state, 'applyMegaEraser')).toContain('this.pushEdit(');
  });

  it('nothing to paste while the buffer is empty', () => {
    expect(state).toContain('get canPasteCells()');
    expect(member(state, 'get canPasteCells')).toContain('this.copiedCells');
  });
});

describe('bottom panel height', () => {
  it('is state, clamped to the divider range and persisted', () => {
    expect(state).toContain('panelHeight = $state');
    expect(member(state, 'setPanelHeight')).toContain('PANEL_HEIGHT_MIN');
    expect(member(state, 'setPanelHeight')).toContain('PANEL_HEIGHT_MAX');
    expect(state).toContain('panelHeight: this.panelHeight');
  });
});

describe('navigation inside a selection (Toonio parity)', () => {
  it('selectFrame keeps a block selection it lands inside', () => {
    expect(member(state, 'selectFrame')).toContain('keepsSelection(');
  });

  it('selectLayer keeps it too', () => {
    expect(member(state, 'selectLayer')).toContain('keepsSelection(');
  });

  it('Ctrl+click falls back to a plain click when the cell is out of reach', () => {
    const select = member(state, 'selectCell');
    expect(select).toContain('toggleLayerInSelection(this.selection, { frame, layer }, this.activeLayer)');
  });
});

describe('onion history (Toonio parity)', () => {
  it('records the frame that was left, not the one arrived at', () => {
    expect(member(state, 'selectFrame')).toContain('pushVisited(this.visitedFrames, this.activeFrame, index)');
  });

  it('starts empty, so one frame change leaves one ghost', () => {
    expect(state).toContain('visitedFrames = $state<number[]>([])');
  });

  it('an insertion before the active frame carries the ghosts along', () => {
    expect(member(state, 'addFrameBeforeActive')).toContain('shiftVisited(');
  });

  it('the ghosts cover every selected layer, and none under the pipette', () => {
    const layers = member(state, 'onionSkinLayers');
    expect(layers).toContain('onionHistoryLayers(');
    expect(state).toContain('onionHistoryLayerIndices');
    expect(member(state, 'onionHistoryLayerIndices')).toContain('this.selection.layers');
  });
});

describe('overwrite confirmation (Toonio parity)', () => {
  it('the state asks through a callback the UI wires up, muted by Alt+Enter', () => {
    expect(state).toContain('ask: (message: string) => boolean');
    expect(member(state, 'confirmed')).toContain('!this.warnings');
  });

  it('a paste over non-empty cells asks, and asks again for a block', () => {
    const apply = member(state, 'applyCopiedCells');
    expect(apply).toContain('pasteNeedsConfirm(this.doc, target)');
    expect(apply).toContain('this.confirmed(');
    expect(apply).toContain('frames > 1 || layers > 1');
  });

  it('deleting a frame asks, and Toonio refuses to delete the last one', () => {
    expect(member(state, 'canRemoveFrame')).toContain("this.ux.playbackRange === 'selection'");
    const remove = member(state, 'removeActiveFrame');
    expect(remove).toContain('this.canRemoveFrame');
    expect(remove).toContain('this.confirmed(');
  });

  it('deleting a layer asks by name, through the same path', () => {
    const remove = member(state, 'removeActiveLayer');
    expect(remove).toContain('this.confirmed(');
    expect(remove).toContain('this.layerLabel(');
  });

  it('the layer panel no longer runs a confirm of its own', async () => {
    const rows = await Bun.file(new URL('./LayerRows.svelte', import.meta.url)).text();
    expect(rows).not.toContain('confirm(');
  });
});

describe('the copied marker', () => {
  it('a stroke into a copied cell clears that cell alone', () => {
    expect(member(state, 'commitStroke')).toContain('this.copiedDrawnInto');
    expect(member(state, 'isCopiedCell')).toContain('this.copiedDrawnInto');
    expect(member(state, 'isCopiedCell')).toContain('this.copiedFrom');
  });

  it('a fresh copy lights every cell of the block again', () => {
    expect(member(state, 'copySelection')).toContain('this.copiedDrawnInto = []');
  });
});

const timelineUi = await Bun.file(new URL('./Timeline.svelte', import.meta.url)).text();

describe('the studio grid selects by dragging (Toonio parity)', () => {
  it('a pointer held across cells paints a rectangle of them', () => {
    expect(timelineUi).toContain('onpointerdown');
    expect(timelineUi).toContain('onpointerenter');
    expect(timelineUi).toContain("editor.selectCell(frame, layer, 'range')");
  });

  it('a finger scrolls the strip instead — only mouse and pen drag-select', () => {
    expect(timelineUi).toContain("e.pointerType === 'touch'");
  });

  it('the cell being dragged onto is scrolled into view', () => {
    expect(timelineUi).toContain('scrollIntoView(');
  });

  it('clicking the empty part of the strip collapses back to the active cell', () => {
    expect(timelineUi).toContain('resetSelection');
    // Not `selectCell`: the active cell is inside the block, so `keepsSelection`
    // would hold onto it — the press has to collapse the block outright.
    expect(timelineUi).toContain('editor.collapseSelection()');
    // The rows fill the strip, so "empty" means any spot inside it that is
    // not a cell button — testing the container against itself never fires.
    expect(timelineUi).toContain(".closest('.cell')");
  });

  it('the copied marker is asked cell by cell, so a drawn-in cell goes dark', () => {
    expect(timelineUi).toContain('editor.isCopiedCell(');
  });
});

describe('frame operations carry the selection with them', () => {
  // The paste target is the selection now, so a selection left behind on the
  // frame you just left would send V into a cell you are not looking at.
  for (const name of ['addFrameAfterActive', 'addFrameBeforeActive', 'removeActiveFrame']) {
    it(`${name} collapses the selection onto the new active cell`, () => {
      expect(member(state, name)).toContain('this.collapseSelection()');
    });
  }
});

describe('layer names never collide with the positional fallback', () => {
  it('the editor names the layer of a document it starts itself', () => {
    // A stored «Слой 2» beside an unnamed layer that has slid to position 2
    // would show the same label twice; naming layer 1 up front avoids it.
    expect(state).toContain("renameLayer(this.doc, 0, t('layer.default_name', { n: 1 }))");
    expect(t('layer.default_name', { n: 1 })).toBe('Слой 1');
  });
});

describe('adding or removing a frame leaves a ghost behind', () => {
  // The reference routes every frame operation through SELECT_FRAME, so
  // `AddHistory(prev)` runs for them exactly as it does for a plain click
  // (`bundle:8584-8600`, `8622-8645`). Skipping it left the new frame with no
  // onion of the frame it was created from.
  it('adding a frame after the active one records the frame left', () => {
    expect(member(state, 'addFrameAfterActive')).toContain('pushVisited(');
  });

  it('inserting before records it and then shifts the whole history', () => {
    const insert = member(state, 'addFrameBeforeActive');
    expect(insert).toContain('pushVisited(');
    expect(insert).toContain('shiftVisited(');
    // Push first, shift second: the cell left behind moved right with the rest.
    expect(insert.indexOf('pushVisited(')).toBeLessThan(insert.indexOf('shiftVisited('));
  });

  it('removing a frame records it too', () => {
    expect(member(state, 'removeActiveFrame')).toContain('pushVisited(');
  });
});

describe('side panel state', () => {
  it('a dragged side keeps its width inside the supported range, and remembers it', () => {
    expect(member(state, 'setSideWidth')).toContain('SIDE_WIDTH_MIN');
    expect(member(state, 'setSideWidth')).toContain('SIDE_WIDTH_MAX');
    expect(member(state, 'setSideWidth')).toContain('this.persistUiConfig()');
  });

  it('collapsing a side is a toggle, and it is remembered too', () => {
    expect(member(state, 'toggleSide')).toContain('collapsed = !');
    expect(member(state, 'toggleSide')).toContain('this.persistUiConfig()');
    expect(state).toContain('sides: ');
  });
});

describe('bottom panel state', () => {
  it('folding the bottom panel is a toggle, and it is remembered', () => {
    expect(member(state, 'togglePanel')).toContain('this.panelCollapsed = !');
    expect(member(state, 'togglePanel')).toContain('this.persistUiConfig()');
    expect(state).toContain('panelCollapsed: this.panelCollapsed');
  });
});
