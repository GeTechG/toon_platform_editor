import { describe, expect, it } from 'bun:test';
import { addFrame, addLayer, addStroke, createDocument, insertFrameBefore, moveLayer, removeFrame, replaceStrokes } from '../model/operations';
import { removeLastStroke, transformStrokes } from '../model/operations';
import type { Frame, Stroke } from '../format/types';
import { dropCells, placeBlock, recell, repoint, restorableBlock, restoreStructure, structureIntact, takeStructure, type StructureSnapshot } from './structure-undo';

// Twenty-first audit, tools. Found by running undo against the store in the
// browser, long mixed chains checked step by step. A block edit knew its cells
// by the object and by the numbers they stood under — and a frame or a layer
// added in front moves the numbers: the cut stayed in the history for ever,
// and Z on the frame took a piece of a cut line.
// A delete put back refilled the first frame with what it held when the delete
// was made — meant for a delete that took every frame, it also brought back a
// paste undone since. And a block edit told its cell by the count alone: a
// stroke taken off the pasted cell and another drawn in its place, and Z took
// the paste back with the new stroke in it.
// Three mirrors, three Z: the third found no step and took a stroke — a
// transform writes in place, and the step under it kept the old object as the
// cell it was made over.
// «Применить» and Esc in the transform window left the focus on <body> in
// Chrome, which sends a focusout for the control it removes.
// And undo of a cut whose strokes no longer fit the mult threw out of the key
// with the step already off the history.
// The store is a runes component, so it is asserted as source, like audit20;
// the walk of the history is checked at the end against a model that knows
// cells by number and content instead of by object.
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
function edit(doc: ReturnType<typeof createDocument>, at: number[], write: (frame: number) => void, layer = 0) {
  const step = at.map((frame) => {
    const was = doc.layers[layer].frames[frame];
    return { was, cell: was, layer, frame, strokes: was.strokes.map((s) => ({ ...s, points: [...s.points] })), after: 0, last: was.strokes[0] };
  });
  at.forEach(write);
  for (const s of step) {
    s.cell = doc.layers[layer].frames[s.frame];
    s.after = s.cell.strokes.length;
    s.last = s.cell.strokes[s.after - 1];
  }
  return step;
}

describe('a block edit is found where its cells stand now', () => {
  const cut = (doc: ReturnType<typeof createDocument>, layer = 0) => (frame: number) =>
    replaceStrokes(doc, layer, frame, doc.layers[layer].frames[frame].strokes.slice(0, 1));

  it('a frame added in front does not close the way back', () => {
    const doc = frames(2);
    const erase = edit(doc, [1], cut(doc));
    insertFrameBefore(doc, 0);
    expect(restorableBlock(doc, [erase], doc.layers[0].frames[2])).toBe(erase);
    placeBlock(doc, erase);
    expect(erase[0].frame).toBe(2);
  });

  it('nor does a layer added under it', () => {
    const doc = frames(1);
    const erase = edit(doc, [0], cut(doc));
    addLayer(doc, 0);
    expect(restorableBlock(doc, [erase], doc.layers[1].frames[0])).toBe(erase);
    placeBlock(doc, erase);
    expect(erase[0].layer).toBe(1);
  });

  it('a cell that left the document keeps its own part of the step, not the rest of it', () => {
    const doc = frames(2);
    const paste = edit(doc, [0, 1], cut(doc));
    doc.layers[0].frames.splice(1, 1);
    expect(restorableBlock(doc, [paste], doc.layers[0].frames[0])).toEqual([paste[0]]);
  });

  it('undo writes where the cells are found', () => {
    const undo = method('undo');
    expect(undo).toContain('placeBlock(this.doc, edit)');
    expect(undo.indexOf('placeBlock(this.doc, edit)')).toBeLessThan(undo.indexOf('this.mayEdit(edit.map'));
  });
});

describe('a delete put back leaves the first frame as it is now', () => {
  it('a paste undone since the delete does not come back with the frames', () => {
    const doc = frames(3);
    doc.layers[0].frames[0] = { strokes: [] };
    const [paste] = edit(doc, [0], (frame) => replaceStrokes(doc, 0, frame, doc.layers[0].frames[1].strokes));
    const snap = takeStructure(doc);
    removeFrame(doc, 2);
    snap.seal(doc);
    // Undo of the paste, as the store does it.
    replaceStrokes(doc, 0, 0, paste.strokes);
    const restored = doc.layers[0].frames[0];
    recell(snap, paste.cell, restored, restored.strokes.length - paste.after);
    recell(snap, paste.was, restored);
    expect(structureIntact(doc, snap)).toBe(true);
    restoreStructure(doc, snap);
    expect(doc.layers[0].frames).toHaveLength(3);
    expect(doc.layers[0].frames[0].strokes).toHaveLength(0);
  });

  it('a delete that took every frame still gives the first one its strokes back', () => {
    const doc = frames(3);
    const snap = takeStructure(doc);
    removeFrame(doc, 0, 3);
    snap.seal(doc);
    expect(doc.layers[0].frames[0].strokes).toHaveLength(0);
    restoreStructure(doc, snap);
    expect(doc.layers[0].frames.map((cell) => cell.strokes.length)).toEqual([2, 2, 2]);
  });

  it('a move redone never refills a cell: its shape was not sealed by a delete', () => {
    const doc = frames(1);
    addLayer(doc, 1);
    moveLayer(doc, 0, 1);
    const after = takeStructure(doc);
    moveLayer(doc, 1, 0);
    doc.layers[0].frames[0] = { strokes: [] };
    after.frames[1][0] = doc.layers[0].frames[0];
    restoreStructure(doc, after);
    expect(doc.layers[1].frames[0].strokes).toHaveLength(0);
  });
});

describe('a block edit knows its cell by more than the count', () => {
  it('a stroke drawn in place of one taken off the pasted cell is not taken with the paste', () => {
    const doc = frames(1);
    const step = edit(doc, [0], (frame) => replaceStrokes(doc, 0, frame, doc.layers[0].frames[frame].strokes.slice(0, 1)));
    const cell = doc.layers[0].frames[0];
    const taken = cell.strokes.pop()!;
    addStroke(doc, 0, 0, { points: [9, 9, 9, 9], width: 8, color: '#000000' });
    expect(cell.strokes).toHaveLength(step[0].after);
    expect(restorableBlock(doc, [step], cell)).toBeUndefined();
    // Redo puts a copy of the same stroke back: the step is whole again.
    cell.strokes.pop();
    cell.strokes.push({ ...taken, points: [...taken.points] });
    expect(restorableBlock(doc, [step], cell)).toBe(step);
  });

  it('a step re-pointed at a restored cell still tells a stroke drawn under a newer edit', () => {
    const doc = frames(1);
    const paste = edit(doc, [0], (frame) => replaceStrokes(doc, 0, frame, doc.layers[0].frames[frame].strokes.slice(0, 1)));
    doc.layers[0].frames[0].strokes.pop();
    addStroke(doc, 0, 0, { points: [9, 9, 9, 9], width: 8, color: '#000000' });
    const [erase] = edit(doc, [0], (frame) => replaceStrokes(doc, 0, frame, []));
    // Undo of the erase, as the store does it: the paste is re-pointed at the new cell.
    replaceStrokes(doc, 0, 0, erase.strokes);
    paste[0].cell = doc.layers[0].frames[0];
    expect(restorableBlock(doc, [paste], doc.layers[0].frames[0])).toBeUndefined();
  });

  it('the store files the last stroke, and leaves it alone when it re-points the cell', () => {
    expect(method('pushEdit')).toContain('snapshot.last = snapshot.cell.strokes[snapshot.after - 1]');
    expect(method('undo')).not.toContain('older.last =');
  });
});

describe('the focus comes back to the tool key when the transform window closes', () => {
  it('the focusout Chrome sends with the removal does not count as leaving the window', async () => {
    // Chrome fires focusout on the control being removed, the window still in
    // the page and no related target — the same as a click on empty space.
    // Read at once, it said the focus had left, and it fell to <body>.
    const menu = await Bun.file(new URL('./TransformMenu.svelte', import.meta.url)).text();
    const keep = menu.slice(menu.indexOf('function keepFocus'), menu.indexOf('</script>'));
    const leave = keep.slice(keep.indexOf('const leave'), keep.indexOf("node.addEventListener('focusin'"));
    expect(leave).toContain('queueMicrotask');
    expect(leave).toMatch(/queueMicrotask\(\(\) => \{\s*if \(node\.isConnected\) inside = false;/);
  });
});

describe('a block edit that no longer fits stays in the history', () => {
  it('undo refused at the mult\'s limit leaves the cells and the step as they were', () => {
    const undo = method('undo');
    const block = undo.slice(undo.indexOf('const edit = this.restorableEdit'), undo.indexOf('const cell = this.activeCell'));
    // Every cell is written before the step leaves the history; a refusal puts the cells back.
    expect(block.indexOf('replaceStrokes(')).toBeLessThan(block.indexOf('this.edits = dropCells('));
    expect(block).toContain('doc.layers[snapshot.layer].frames[snapshot.frame] = left[i]');
    expect(block.indexOf('this.refuseAtLimit(err)')).toBeLessThan(block.indexOf('this.edits = dropCells('));
  });
});

describe('a step over several frames goes back frame by frame when one of them was edited since', () => {
  // Owner, after the twenty-first audit: a paste over frames 3–4, a stroke on
  // 4, Z on 3 — the paste leaves frame 3 alone; the rest of the step stays in
  // the history and is taken back from frame 4. It used to take a stroke of
  // the pasted drawing off frame 3 and leave the paste with no way back.
  const paste = (doc: ReturnType<typeof createDocument>) =>
    edit(doc, [0, 1], (frame) => replaceStrokes(doc, 0, frame, [{ points: [7, 7, 9, 9], tool_id: 0 }]));

  it('the cell stood on goes back alone, and the step keeps the others', () => {
    const doc = frames(2);
    const step = paste(doc);
    addStroke(doc, 0, 1, { points: [9, 9, 9, 9], width: 8, color: '#000000' });
    const own = restorableBlock(doc, [step], doc.layers[0].frames[0]);
    expect(own).toEqual([step[0]]);
    const left = dropCells([step], own!);
    expect(left).toEqual([[step[1]]]);
    // From the other frame the stroke goes first, then what is left of the paste.
    expect(restorableBlock(doc, left, doc.layers[0].frames[1])).toBeUndefined();
    doc.layers[0].frames[1].strokes.pop();
    const rest = restorableBlock(doc, left, doc.layers[0].frames[1]);
    expect(rest).toEqual([step[1]]);
    expect(dropCells(left, rest!)).toEqual([]);
  });

  it('a cell of the step that was itself drawn on gives a stroke, as ever', () => {
    const doc = frames(2);
    const step = paste(doc);
    addStroke(doc, 0, 0, { points: [9, 9, 9, 9], width: 8, color: '#000000' });
    addStroke(doc, 0, 1, { points: [9, 9, 9, 9], width: 8, color: '#000000' });
    expect(restorableBlock(doc, [step], doc.layers[0].frames[0])).toBeUndefined();
  });

  it('a step whole on every frame still goes back whole, and leaves the history whole', () => {
    const doc = frames(2);
    const step = paste(doc);
    expect(restorableBlock(doc, [step], doc.layers[0].frames[0])).toBe(step);
    const other = { snap: takeStructure(doc) };
    expect(dropCells([other, step], step)).toEqual([other]);
    // A step whose last cell went back alone is gone too: it would undo nothing.
    expect(dropCells([other, [step[0]]], [step[0]])).toEqual([other]);
  });

  it('the store drops what went back, and files only the cells an edit changed', () => {
    const undo = method('undo');
    expect(undo).toContain('this.edits = dropCells(this.edits, edit)');
    // A cell the paste left as it was is no part of the step: taken back
    // alone it changed nothing, and Z looked dead.
    const push = method('pushEdit');
    expect(push).toContain('const changed = snapshots.filter(');
    expect(push).toContain('this.edits = [...this.edits, changed]');
  });

  it('redo has nothing to give after it, as after any block edit taken back', () => {
    const undo = method('undo');
    const block = undo.slice(undo.indexOf('const edit = this.restorableEdit'), undo.indexOf('const cell = this.activeCell'));
    expect(block).toContain('this.undone = [];');
    expect(block).toContain('this.redoStructure = null;');
  });
});

describe('edits made in place are walked back one by one', () => {
  it('three transforms of one cell, three steps back', () => {
    const doc = frames(1);
    const before = JSON.stringify(doc.layers[0].frames[0].strokes);
    const steps = [1, 2, 3].map(() => edit(doc, [0], (frame) => transformStrokes(doc, 0, frame, null, [1, 0, 0, 1, 8, 0])));
    while (steps.length > 0) {
      const step = restorableBlock(doc, steps, doc.layers[0].frames[0]);
      expect(step).toBe(steps[steps.length - 1]);
      steps.pop();
      replaceStrokes(doc, 0, 0, step![0].strokes);
      repoint(steps, step![0], doc.layers[0].frames[0]);
    }
    expect(JSON.stringify(doc.layers[0].frames[0].strokes)).toBe(before);
  });
});

/**
 * The store's undo, on the pure functions it is made of: a delete on top and
 * intact goes first, then the block edit of the cell stood on, then a stroke.
 */
type Cell = { cell: Frame; was: Frame; layer: number; frame: number; strokes: Stroke[]; after: number; last?: Stroke };
type Step = Cell[] | { snap: StructureSnapshot };

function studio() {
  const doc = createDocument();
  let edits: Step[] = [];
  const block = (frames: number[], write: (frame: number) => void) => {
    const step: Cell[] = frames.map((frame) => {
      const was = doc.layers[0].frames[frame];
      return { was, cell: was, layer: 0, frame, strokes: was.strokes.map((s) => ({ ...s, points: [...s.points] })), after: 0 };
    });
    frames.forEach(write);
    // Only the cells it changed are the step; the others get their object back.
    const changed = step.filter((s) => JSON.stringify(s.strokes) !== JSON.stringify(doc.layers[0].frames[s.frame].strokes));
    step.filter((s) => !changed.includes(s)).forEach((s) => (doc.layers[0].frames[s.frame] = s.cell));
    if (changed.length === 0) {
      return;
    }
    for (const s of changed) {
      s.cell = doc.layers[0].frames[s.frame];
      s.after = s.cell.strokes.length;
      s.last = s.cell.strokes[s.after - 1];
    }
    edits.push(changed);
  };
  return {
    doc,
    block,
    remove(frame: number) {
      const snap = takeStructure(doc);
      removeFrame(doc, frame);
      snap.seal(doc);
      edits.push({ snap });
    },
    /** Steps left in the history that hold no cell: there must never be one. */
    hollow: () => edits.filter((e) => Array.isArray(e) && e.length === 0).length,
    /** What Z did on `frame`: 'structure', 'block', 'stroke' or nothing. */
    undo(frame: number): string | undefined {
      const top = edits[edits.length - 1];
      if (top && !Array.isArray(top) && structureIntact(doc, top.snap)) {
        edits.pop();
        restoreStructure(doc, top.snap);
        return 'structure';
      }
      const step = restorableBlock<Cell>(doc, edits, doc.layers[0].frames[frame]);
      if (step) {
        placeBlock(doc, step);
        edits = dropCells(edits, step);
        for (const s of step) {
          replaceStrokes(doc, 0, s.frame, s.strokes);
          repoint(edits, s, doc.layers[0].frames[s.frame]);
        }
        return 'block';
      }
      return removeLastStroke(doc, 0, frame) ? 'stroke' : undefined;
    },
  };
}

describe('undo against a model that knows cells by number and content', () => {
  it('never takes back what a step did not write, and never passes a cell it could give back', () => {
    // How often a cell went back without the rest of its step: the rule is walked, not skipped.
    let alone = 0;
    for (let seed = 1; seed <= 300; seed++) {
      let r = (seed * 2654435761) >>> 0;
      const rnd = (n: number) => {
        r ^= r << 13; r >>>= 0; r ^= r >>> 17; r ^= r << 5; r >>>= 0;
        return r % n;
      };
      const s = studio();
      const doc = s.doc;
      // The model: every cell has a number; its history is a stack of what
      // each step left in it. A block step may go back while every cell it
      // wrote has it on top of its stack and holds what it left.
      const ids = new Map<Frame, number>();
      let nextId = 1;
      let nextStep = 1;
      let mark = 1;
      type Entry = { step: number; kind: 'stroke' | 'block'; pre: string; post: string };
      const stacks = new Map<number, Entry[]>();
      const stack = (id: number) => stacks.get(id) ?? stacks.set(id, []).get(id)!;
      const text = (cell: Frame) => JSON.stringify(cell.strokes.map((x) => x.points));
      const row = () => doc.layers[0].frames;
      const look = () => row().map((cell) => ({ id: ids.get(cell)!, text: text(cell) }));
      // A cell written anew takes the number of the one that stood there.
      const relink = (was: Frame[]) => row().forEach((cell, f) => {
        if (!ids.has(cell)) ids.set(cell, was.length === row().length ? ids.get(was[f])! : nextId++);
      });
      relink([]);
      const trace: string[] = [];
      const forward = (name: string, kind: Entry['kind'], run: () => void) => {
        const was = [...row()];
        const before = look();
        run();
        relink(was);
        const step = nextStep++;
        for (const now of look()) {
          const old = before.find((b) => b.id === now.id);
          if (old && old.text !== now.text) stack(now.id).push({ step, kind, pre: old.text, post: now.text });
        }
        trace.push(name);
      };
      const stroke = (frame: number) => forward(`stroke ${frame}`, 'stroke', () =>
        addStroke(doc, 0, frame, { points: [mark, mark, mark + 40, mark++], width: 8, color: '#000000' }));
      stroke(0);
      stroke(0);
      for (let i = 0; i < 60; i++) {
        const frame = rnd(row().length);
        const k = rnd(20);
        if (k < 5) stroke(frame);
        else if (k < 7) forward(`cut ${frame}`, 'block', () => s.block([frame], (f) => replaceStrokes(doc, 0, f, row()[f].strokes.slice(0, -1).concat(row()[f].strokes.slice(0, 1)))));
        else if (k < 9) forward(`move ${frame}`, 'block', () => s.block([frame], (f) => transformStrokes(doc, 0, f, null, [1, 0, 0, 1, 3, 0])));
        else if (k < 11) {
          const other = rnd(row().length);
          const both = [...new Set([frame, other])];
          forward(`paste ${both}`, 'block', () => s.block(both, (f) => replaceStrokes(doc, 0, f, [{ points: [mark, 0, mark++, 9], tool_id: 0 }])));
        }
        else if (k < 12 && row().length < 5) forward(`frame before ${frame}`, 'block', () => insertFrameBefore(doc, frame));
        else if (k < 13 && row().length < 5) forward(`frame after ${frame}`, 'block', () => addFrame(doc, frame));
        else if (k < 14 && row().length > 1) forward(`delete ${frame}`, 'block', () => s.remove(frame));
        else {
          const active = ids.get(row()[frame])!;
          const was = [...row()];
          const before = look();
          const top = stack(active)[stack(active).length - 1];
          // Every cell the step wrote still has it on top and holds what it left.
          // The cell stood on holds what its newest step left: that step gives
          // it back — with the rest of its cells while they are whole too,
          // alone once one of them was edited since (owner, after the 21st audit).
          const own = top?.kind === 'block' && before.find((b) => b.id === active)?.text === top.post;
          const mates = top ? [...stacks].filter(([, st]) => st.some((e) => e.step === top.step)).map(([id]) => id) : [];
          const whole = own && mates.every((id) => {
            const st = stack(id);
            const here = before.find((b) => b.id === id);
            return st[st.length - 1].step === top!.step && here?.text === st[st.length - 1].post;
          });
          const did = s.undo(frame);
          relink(was);
          const after = look();
          const say = `seed ${seed}: ${trace.join('; ')}; Z ${frame} -> ${did}`;
          if (did === 'structure') {
            // The frames are back; nothing that stood there changed.
            for (const b of before) expect(after.find((a) => a.id === b.id)?.text, say).toBe(b.text);
            expect(after.length, say).toBe(before.length + 1);
          } else if (did === 'block') {
            expect(own, say).toBe(true);
            const back = after.filter((a) => a.text !== before.find((x) => x.id === a.id)!.text).map((a) => a.id);
            // The cell stood on always; the others of the step only while every one is whole.
            expect(back, say).toContain(active);
            if (whole) expect([...back].sort(), say).toEqual([...mates].sort());
            else expect(back, say).toEqual([active]);
            if (!whole && mates.length > 1) alone++;
            expect(s.hollow(), say).toBe(0);
            for (const a of after) {
              const b = before.find((x) => x.id === a.id)!;
              if (a.text === b.text) continue;
              const entry = stack(a.id).pop();
              // Never over a newer step of the cell, never over a stroke drawn since.
              expect(entry?.kind, say).toBe('block');
              expect(entry?.post, say).toBe(b.text);
              expect(a.text, say).toBe(entry!.pre);
            }
          } else if (did === 'stroke') {
            // A cell its step could give back is never passed for a stroke.
            expect(own, say).toBe(false);
            const st = stack(active);
            if (st[st.length - 1]?.kind === 'stroke') {
              st.pop();
            } else {
              // A stroke of what a step left is gone: this cell of it has no way back.
              stacks.set(active, []);
            }
          }
          trace.push(`Z ${frame}`);
        }
      }
    }
    expect(alone).toBeGreaterThan(20);
  });
});
