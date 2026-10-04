import { describe, expect, it } from 'bun:test';
import { addFrame, addStroke, createDocument, removeFrame, replaceStrokes, transformStrokes } from '../model/operations';
import { recell, repoint, restorableBlock, restoreStructure, structureIntact, takeStructure } from './structure-undo';

// Twentieth audit, tools. The nineteenth let undo reach a block edit lying
// under edits of other frames — and with it a paste over two frames could be
// taken back past a transform made since on one of them: a transform rewrites
// the cell in place, so the cell looked untouched. A block edit undone after a
// frame was deleted put a new cell object where the delete remembered the old
// one, and the delete could not be undone any more. And a press on a layer's
// row while the preview ran collapsed the block of frames being played.
// The store is a runes component, so it is asserted as source, like audit19.
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();

function method(name: string): string {
  const match = state.match(new RegExp(`\\n  (?:get |private )?${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

function frames(count: number) {
  const doc = createDocument();
  for (let i = 1; i < count; i++) addFrame(doc, i - 1);
  for (let frame = 0; frame < count; frame++) {
    addStroke(doc, 0, frame, { points: [1, 2, 3, 4], width: 8, color: '#000000' });
    addStroke(doc, 0, frame, { points: [5, 6, 7, 8], width: 8, color: '#000000' });
  }
  return doc;
}

/** A block edit as the store files it: what the cells were, and what it left. */
function edit(doc: ReturnType<typeof createDocument>, at: number[], write: (frame: number) => void) {
  const step = at.map((frame) => {
    const was = doc.layers[0].frames[frame];
    return { was, cell: was, layer: 0, frame, strokes: was.strokes.map((s) => ({ ...s, points: [...s.points] })), after: 0 };
  });
  at.forEach(write);
  for (const s of step) {
    s.cell = doc.layers[0].frames[s.frame];
    s.after = s.cell.strokes.length;
  }
  return step;
}

describe('an older block edit is not reached past a newer one of its cells', () => {
  it('a transform made since on one cell of a paste keeps that cell of the paste where it is', () => {
    const doc = frames(2);
    const paste = edit(doc, [0, 1], (frame) => replaceStrokes(doc, 0, frame, doc.layers[0].frames[frame].strokes.slice(0, 1)));
    // In place: the same cell object, the same count.
    const moved = edit(doc, [1], (frame) => transformStrokes(doc, 0, frame, null, [1, 0, 0, 1, 8, 0]));
    expect(moved[0].cell).toBe(paste[1].cell);
    const edits = [paste, moved];
    // The other cell goes back alone (owner, after the twenty-first audit):
    // the paste is never taken off the frame the transform was made on.
    expect(restorableBlock(doc, edits, doc.layers[0].frames[0])).toEqual([paste[0]]);
    // From the frame the transform was made on it goes first, as ever.
    expect(restorableBlock(doc, edits, doc.layers[0].frames[1])).toBe(moved);
    expect(restorableBlock(doc, [paste], doc.layers[0].frames[0])).toBe(paste);
  });
});

describe('a delete is still undone after a block edit over it was', () => {
  it('the cell the undo put back is the one the delete remembers', () => {
    const doc = frames(3);
    const snap = takeStructure(doc);
    removeFrame(doc, 2);
    snap.seal(doc);
    const [erase] = edit(doc, [0], (frame) => replaceStrokes(doc, 0, frame, doc.layers[0].frames[frame].strokes.slice(0, 1)));
    // Undo of the erase, as the store does it: a fresh cell with the old strokes.
    replaceStrokes(doc, 0, 0, erase.strokes);
    const restored = doc.layers[0].frames[0];
    expect(structureIntact(doc, snap)).toBe(false);
    recell(snap, erase.cell, restored, restored.strokes.length - erase.after);
    recell(snap, erase.was, restored);
    expect(structureIntact(doc, snap)).toBe(true);
    restoreStructure(doc, snap);
    expect(doc.layers[0].frames).toHaveLength(3);
    expect(doc.layers[0].frames[0]).toBe(restored);
  });

  it('an edit older than the delete, undone since, comes back with the frames', () => {
    const doc = frames(3);
    const [erase] = edit(doc, [0], (frame) => replaceStrokes(doc, 0, frame, doc.layers[0].frames[frame].strokes.slice(0, 1)));
    const snap = takeStructure(doc);
    removeFrame(doc, 2);
    snap.seal(doc);
    replaceStrokes(doc, 0, 0, erase.strokes);
    const restored = doc.layers[0].frames[0];
    recell(snap, erase.cell, restored, restored.strokes.length - erase.after);
    recell(snap, erase.was, restored);
    expect(structureIntact(doc, snap)).toBe(true);
    restoreStructure(doc, snap);
    expect(doc.layers[0].frames[0].strokes).toHaveLength(2);
  });

  it('the store re-points every delete in the history, and the move it would redo', () => {
    // Since the twenty-first audit the walk lives beside `recell`, as `repoint`.
    expect(method('undo')).toContain('repoint(this.edits, snapshot, this.doc.layers[snapshot.layer].frames[snapshot.frame])');
    const doc = frames(2);
    const move = { snap: takeStructure(doc), redo: { snap: takeStructure(doc) } };
    move.snap.seal(doc);
    const [erase] = edit(doc, [0], (frame) => replaceStrokes(doc, 0, frame, doc.layers[0].frames[frame].strokes.slice(0, 1)));
    replaceStrokes(doc, 0, 0, erase.strokes);
    repoint([move], erase, doc.layers[0].frames[0]);
    expect(move.snap.frames[0][0]).toBe(doc.layers[0].frames[0]);
    expect(move.snap.after!.frames[0][0]).toBe(doc.layers[0].frames[0]);
    expect(move.redo.snap.frames[0][0]).toBe(doc.layers[0].frames[0]);
  });
});

describe('the block of frames outlives a press on a layer during the preview', () => {
  it('a layer picked or moved while it plays keeps the frames selected', () => {
    expect(method('collapseSelection')).toContain('this.playing ? this.selection.frames : [this.activeFrame]');
    const pick = method('selectLayer');
    expect(pick).toContain('this.selection = { frames: this.playing ? this.selection.frames : [this.activeFrame], layers: [index] }');
  });
});
