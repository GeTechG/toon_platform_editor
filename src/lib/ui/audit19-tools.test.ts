import { describe, expect, it } from 'bun:test';
import { addFrame, addStroke, createDocument, replaceStrokes } from '../model/operations';
import { EMPTY_TRANSFORM, nudged, sameSession } from '../tools/lasso';
import { restorableBlock } from './structure-undo';

// Nineteenth audit, tools: a sweep of the mega eraser on one frame and another
// on the next left the first with no way back — Z there took a piece of a cut
// line instead; and a press on the selection that moved nothing (a pen's
// pressure alone, a scale key at the floor, the same number typed again) filed
// a step of the session that undid nothing and made the tab ask on the way out.
// The store is a runes component, so it is asserted as source, like audit18.
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const canvas = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();

function method(name: string): string {
  const match = state.match(new RegExp(`\\n  (?:get |private )?${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

/** A block edit of one cell, as the store files it: the cell it left and its count. */
function edited(doc: ReturnType<typeof createDocument>, frame: number) {
  const strokes = doc.layers[0].frames[frame].strokes;
  replaceStrokes(doc, 0, frame, strokes.slice(0, 1));
  const cell = doc.layers[0].frames[frame];
  return [{ cell, layer: 0, frame, after: cell.strokes.length }];
}

function twoFrames() {
  const doc = createDocument();
  addFrame(doc, 0);
  for (const frame of [0, 1]) {
    addStroke(doc, 0, frame, { points: [1, 2, 3, 4], width: 8, color: '#000000' });
    addStroke(doc, 0, frame, { points: [5, 6, 7, 8], width: 8, color: '#000000' });
  }
  return doc;
}

describe('a block edit is undone from the cell it was made in', () => {
  it('an edit of another frame made since does not close the way back', () => {
    const doc = twoFrames();
    const first = edited(doc, 0);
    const second = edited(doc, 1);
    const edits = [first, second];
    expect(restorableBlock(doc, edits, doc.layers[0].frames[0])).toBe(first);
    expect(restorableBlock(doc, edits, doc.layers[0].frames[1])).toBe(second);
  });

  it('the newest edit of the cell is the one, and only while the cell is as it left it', () => {
    const doc = twoFrames();
    const first = edited(doc, 0);
    // A second edit over the same cell, in place — what a transform does.
    const cell = doc.layers[0].frames[0];
    const second = [{ cell, layer: 0, frame: 0, after: cell.strokes.length }];
    expect(restorableBlock(doc, [first, second], cell)).toBe(second);
    // A stroke drawn since goes first.
    addStroke(doc, 0, 0, { points: [9, 9], width: 8, color: '#000000' });
    expect(restorableBlock(doc, [first, second], cell)).toBeUndefined();
  });

  it('a delete in the history is stepped over, not taken for a block', () => {
    const doc = twoFrames();
    const first = edited(doc, 0);
    expect(restorableBlock(doc, [first, { snap: {} }], doc.layers[0].frames[0])).toBe(first);
    expect(restorableBlock(doc, [{ snap: {} }], doc.layers[0].frames[0])).toBeUndefined();
  });

  it('the store asks it, and takes that step off the history wherever it lies', () => {
    expect(method('restorableEdit')).toContain('restorableBlock<CellSnapshot>(this.doc, this.edits, this.activeCell)');
    const undo = method('undo');
    // Since the owner's answer after the twenty-first audit a step may go cell by cell.
    expect(undo).toContain('this.edits = dropCells(this.edits, edit)');
  });
});

describe('a step of the session is a change of it', () => {
  it('two sessions are the same by their numbers', () => {
    expect(sameSession(EMPTY_TRANSFORM, { ...EMPTY_TRANSFORM })).toBe(true);
    expect(sameSession(EMPTY_TRANSFORM, { ...EMPTY_TRANSFORM, dx: 1 })).toBe(false);
    // The scale key at the 1 % floor hands the session back in a new object.
    const floor = { ...EMPTY_TRANSFORM, scaleX: 0.01, scaleY: 0.01 };
    expect(sameSession(floor, nudged(floor, 'scale', -1, false))).toBe(true);
  });

  it('the store files nothing for a session that did not change, and says so', () => {
    const set = method('setTransform');
    expect(set).toContain('sameSession(session, open.session)');
    expect(set.indexOf('sameSession(')).toBeLessThan(set.indexOf('this.transform = {'));
    expect(set).toContain('return false');
  });

  it('a drag has begun only once a move of it was filed', () => {
    // `moved` set by the first event, the next one replaced the step before
    // the drag — the one the press had nothing to do with.
    const drag = canvas.slice(canvas.indexOf('function dragTransform'), canvas.indexOf('function commitPendingStroke'));
    expect(drag).not.toContain('grab.moved = true');
    expect(drag).toContain('grab.moved = editor.setTransform(next, grab.moved) || grab.moved');
  });
});
