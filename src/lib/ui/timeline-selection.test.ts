import { describe, expect, it } from 'bun:test';

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

  it('both land the buffer from the active cell, clipped to the document', () => {
    const shared = member(state, 'applyCopiedCells');
    expect(shared).toContain('pasteTarget(');
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

describe('timeline height', () => {
  it('is state, clamped to the divider range and persisted', () => {
    expect(state).toContain('timelineHeight = $state');
    expect(member(state, 'setTimelineHeight')).toContain('TIMELINE_HEIGHT_MIN');
    expect(member(state, 'setTimelineHeight')).toContain('TIMELINE_HEIGHT_MAX');
    expect(member(state, 'persistUiConfig')).toContain('timelineHeight: this.timelineHeight');
  });
});
