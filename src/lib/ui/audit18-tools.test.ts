import { describe, expect, it } from 'bun:test';
import { addStroke, createDocument, replaceStrokes } from '../model/operations';
import { eraseStrokes } from '../tools/mega-eraser';
import type { ToolDescriptor } from '../format/types';

// Eighteenth audit, tools: a second Z after two sweeps of the mega eraser (or
// two mirrors, two transforms) took a stroke instead of the first sweep, a
// help tool handed back a tool whose key had left the panels, and a cut
// declared «cells» for a mark with no width hung the release.
// The store is a runes component, so it is asserted as source, like audit17.
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();

const walk = await Bun.file(new URL('./structure-undo.ts', import.meta.url)).text();

function method(name: string): string {
  const match = state.match(new RegExp(`\\n  (?:get |private )?${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

describe('two block edits of one cell are two steps of undo', () => {
  it('a restore makes a new cell — which is why the step under it lost its own', () => {
    const doc = createDocument();
    addStroke(doc, 0, 0, { points: [1, 2, 3, 4], width: 8, color: '#000000' });
    const left = doc.layers[0].frames[0];
    replaceStrokes(doc, 0, 0, left.strokes);
    expect(doc.layers[0].frames[0]).not.toBe(left);
  });

  it('the snapshot keeps the cell it was taken from', () => {
    expect(method('snapshotCells')).toContain('was: cell');
    // pushEdit moves `cell` on to what the edit left; `was` stays.
    expect(method('pushEdit')).not.toContain('snapshot.was =');
  });

  it('undo hands the restored cell to the steps that knew the old one', () => {
    // The first sweep's step named the cell it left; undoing the second put
    // a fresh object there, the step no longer matched, and the next Z took
    // the last stroke of the frame instead of giving the first sweep back.
    const undo = method('undo');
    const block = undo.slice(undo.indexOf('const edit = this.restorableEdit'), undo.indexOf('const cell = this.activeCell'));
    // Since the twenty-first audit the walk is `repoint` in structure-undo.ts.
    expect(block.indexOf('replaceStrokes(')).toBeLessThan(block.indexOf('repoint(this.edits, snapshot,'));
    expect(walk).toContain('older.cell === undone.was');
    expect(walk).toContain('older.cell = restored');
  });
});

describe('a help tool hands back only a tool that is on the panels', () => {
  it('the way back goes to the pencil with the key it led to', () => {
    // The pipette in hand, the feather's key moved to the shelf (or a preset
    // without it picked): the next colour taken put the feather in the hand,
    // a tool with no key anywhere (owner, sixteenth audit: the pencil).
    const keep = method('keepToolOnPanel');
    expect(keep).toContain('this.availableTools.includes(this.previousDrawingTool)');
    expect(keep).toContain("this.previousDrawingTool = 'pencil'");
  });
});

describe('a cut by cells needs a cell', () => {
  it('a mark with no width is cut as a line instead of walking a grid of step 0', () => {
    // A plugin that declares `cut: 'cells'` for a contour: the walk between
    // two cells added 0 until the tab was closed.
    const tools: ToolDescriptor[] = [{ kind: 'contour', geometry: 'line', color: '#000000' }];
    const strokes = [{ points: [0, 0, 100, 0, 100, 100], tool_id: 0 }];
    const after = eraseStrokes(strokes, [50, 0], 10, tools, () => 'cells');
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((piece) => piece.points.length >= 2)).toBe(true);
  });
});
