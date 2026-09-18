import { describe, expect, it } from 'bun:test';
import { addStroke, createDocument, removeLastStroke } from '../model/operations';

// EditorState is a runes class, so it is asserted as source (same contract
// style as layers-panel.test.ts); the model round trip redo depends on is
// exercised for real.
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const canvasView = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

function member(source: string, name: string): string {
  const match = source.match(new RegExp(`(get )?${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

describe('redo round trip through the model', () => {
  it('puts a popped stroke back without duplicating its tool', () => {
    const doc = createDocument();
    addStroke(doc, 0, 0, { points: [1, 2, 3, 4], width: 8, color: '#000000' });
    addStroke(doc, 0, 0, { points: [5, 6], width: 8, color: '#ff0000' });
    const before = structuredClone(doc.layers[0].frames[0].strokes);
    const popped = structuredClone(doc.layers[0].frames[0].strokes[1]);

    expect(removeLastStroke(doc, 0, 0)).toBe(true);
    // What redo does: the stroke's tool is still interned, so re-adding it
    // resolves to the same tool_id instead of growing doc.tools.
    addStroke(doc, 0, 0, { points: popped.points, tool: doc.tools[popped.tool_id] });

    expect(doc.layers[0].frames[0].strokes).toEqual(before);
    expect(doc.tools).toHaveLength(2);
  });
});

describe('undo/redo availability', () => {
  it('reports undo availability from the active cell, never mid-playback', () => {
    const canUndo = member(state, 'get canUndo');
    expect(canUndo).toContain('this.playing');
    expect(canUndo).toContain('strokes.length');
  });

  it('offers redo only for the cell the stroke was undone from', () => {
    const canRedo = member(state, 'get canRedo');
    expect(canRedo).toContain('this.playing');
    // Cell identity, not an index: a frame added, removed or pasted over
    // replaces the cell, which retires its redo entries for free.
    expect(canRedo).toContain('this.activeCell');
  });

  it('remembers what undo removed and hands it back on redo', () => {
    expect(member(state, 'undo')).toContain('this.undone.push');
    expect(member(state, 'redo')).toContain('addStroke(');
  });

  it('caps the history so a long session cannot grow without bound', () => {
    expect(state).toContain('UNDO_HISTORY_LIMIT');
    expect(member(state, 'undo')).toContain('UNDO_HISTORY_LIMIT');
  });

  it('ends the redo chain when a new stroke is drawn', () => {
    // Strokes land through the state, not straight into the document, so
    // there is one place where a fresh stroke retires the redo stack.
    expect(member(state, 'commitStroke')).toContain('this.undone = []');
    expect(canvasView).toContain('editor.commitStroke(');
    expect(canvasView).not.toContain('addStroke(editor.doc');
  });
});

describe('editor toolbar and hotkeys', () => {
  it('keeps z on undo and gives redo its own bare key', () => {
    expect(editorUi).toContain("case 'z':");
    expect(editorUi).toContain('editor.undo()');
    expect(editorUi).toContain("case 'y':");
    expect(editorUi).toContain('editor.redo()');
  });

  it('shows undo and redo keys that disable when there is nothing to do', () => {
    expect(editorUi).toContain('Отменить');
    expect(editorUi).toContain('Вернуть');
    expect(editorUi).toContain('disabled={!editor.canUndo}');
    expect(editorUi).toContain('disabled={!editor.canRedo}');
  });
});
