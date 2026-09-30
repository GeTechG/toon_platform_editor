import { describe, expect, it } from 'bun:test';
import { SQUARE_STAMP } from '../format/types';
import type { LineToolDescriptor } from '../format/types';
import { MAX_STROKE_COORDS } from '../format/constants';
import { addStroke, createDocument, mirrorCell, transformStrokes } from '../model/operations';
import { transformMatrix } from '../model/geom';
import { EMPTY_TRANSFORM, hitMode, selectionBounds } from '../tools/lasso';
import { PointerStrokeController, type StrokeRules } from '../tools/profiles';
import { eraseStrokes } from '../tools/mega-eraser';
import { t } from '../i18n';
import { withoutLetterKeys } from './key-owner';

// Fourteenth audit, tools: a pixel mark moved by its corner, a selection that
// is all handle, a cubic line cut past the format, the plugin write the
// format refuses, and the tool in hand that outlives its plugin.
// The store is runes state, so it is asserted as source, like audit13.
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const canvas = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
const play = await Bun.file(new URL('./PlayControls.svelte', import.meta.url)).text();
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

function method(name: string): string {
  const match = state.match(new RegExp(`\\n  (?:get |private )?${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

const stamp = (width: number) =>
  ({ kind: 'stamp', geometry: 'line', width, color: '#000000', shape: [...SQUARE_STAMP] }) as const;

/** A row of pixel cells, edge to edge, from `x0` along y = 0. */
function pixelRow(width: number, xs: number[]) {
  const doc = createDocument({ width: 4000, height: 4000 });
  addStroke(doc, 0, 0, { points: xs.flatMap((x) => [x, 0]), tool: stamp(width) });
  return doc;
}

const xsOf = (points: readonly number[]) => points.filter((_, i) => i % 2 === 0).sort((a, b) => a - b);

describe('a pixel mark is moved by what it covers, not by the corner it is stamped from', () => {
  it('H mirrors a row of cells into the same cells across the sheet', () => {
    // A cell at 0 covers 0..20; its mirror covers 3980..4000. The corner was
    // mirrored instead, so the cell landed at 4000 — one cell off the sheet.
    const doc = pixelRow(20, [0, 20, 40]);
    mirrorCell(doc, 0, 0, 'horizontal');
    expect(xsOf(doc.layers[0].frames[0].strokes[0].points)).toEqual([3940, 3960, 3980]);
  });

  it('mirrored twice, a row comes back to where it was', () => {
    const doc = pixelRow(20, [100, 120, 140]);
    mirrorCell(doc, 0, 0, 'vertical');
    mirrorCell(doc, 0, 0, 'vertical');
    expect(doc.layers[0].frames[0].strokes[0].points).toEqual([100, 0, 120, 0, 140, 0]);
  });

  it('a half turn about the row keeps it on the cells it covered', () => {
    // Cells 0..60 across, 0..20 down: the middle is 30, 10.
    const doc = pixelRow(20, [0, 20, 40]);
    transformStrokes(doc, 0, 0, null, transformMatrix({ rotate: 180 }, 30, 10));
    expect(xsOf(doc.layers[0].frames[0].strokes[0].points)).toEqual([0, 20, 40]);
    expect(doc.layers[0].frames[0].strokes[0].points.filter((_, i) => i % 2)).toEqual([0, 0, 0]);
  });

  it('the live preview of a transform places the cells the same way apply does', () => {
    expect(canvas).toContain('placeStrokePoints(');
  });

  it('the selection box reaches the far edge of the last cell', () => {
    // The handles sat on the corners, a cell short on the right and below,
    // and the selection turned about a point half a cell off its middle.
    const strokes = [{ points: [0, 0, 20, 0, 40, 0], width: 20 }];
    expect(selectionBounds(strokes, null, (stroke) => stroke.width))
      .toEqual({ x: 0, y: 0, width: 60, height: 20 });
    expect(method('beginTransform')).toContain('markReach');
  });
});

describe('a thin selection can be dragged by its body', () => {
  // 100 % zoom: an eighth of a screen pixel per document unit, so the handle
  // band is 80 units deep.
  const zoom = 1 / 8;

  it('a straight horizontal line is moved, not scaled by a height it has none of', () => {
    // Height 0: every press on the line was the top handle, which scales
    // nothing — the line could only be moved from the keyboard.
    const box = { x: 0, y: 100, width: 800, height: 0 };
    expect(hitMode(400, 100, box, EMPTY_TRANSFORM, zoom)).toBe('move');
    expect(hitMode(400, 150, box, EMPTY_TRANSFORM, zoom)).toBe('move');
  });

  it('a single dot is moved', () => {
    const box = { x: 50, y: 50, width: 0, height: 0 };
    expect(hitMode(55, 45, box, EMPTY_TRANSFORM, zoom)).toBe('move');
  });

  it('a line thinner than two handles is moved from inside and scaled from just outside', () => {
    // A hand-drawn line 40 units tall was all top handle.
    const box = { x: 0, y: 100, width: 800, height: 40 };
    expect(hitMode(400, 120, box, EMPTY_TRANSFORM, zoom)).toBe('move');
    expect(hitMode(400, 60, box, EMPTY_TRANSFORM, zoom)).toBe('scale-u');
    expect(hitMode(400, 180, box, EMPTY_TRANSFORM, zoom)).toBe('scale-d');
    expect(hitMode(0, 120, box, EMPTY_TRANSFORM, zoom)).toBe('scale-l');
  });

  it('a box of a good size keeps the reference handles', () => {
    const box = { x: 0, y: 0, width: 800, height: 800 };
    expect(hitMode(400, 10, box, EMPTY_TRANSFORM, zoom)).toBe('scale-u');
    expect(hitMode(5, 5, box, EMPTY_TRANSFORM, zoom)).toBe('scale-ul');
    expect(hitMode(400, 400, box, EMPTY_TRANSFORM, zoom)).toBe('move');
  });
});

describe('a cubic line stays a start point and whole segments', () => {
  const cubic: LineToolDescriptor = { kind: 'pencil', geometry: 'cubic', width: 40, color: '#000000' };
  const sample = (x: number, y: number) => ({ pointerId: 1, isPrimary: true, x, y });

  it('cut at the format limit, it keeps whole segments', () => {
    // The cut kept the limit's worth of points and put the last one back:
    // 65536 is not 2 + 6n, and the draft with that stroke never opened again.
    const rules: StrokeRules = { capture: (_line, batch) => [...batch] };
    const pointer = new PointerStrokeController(() => ({ descriptor: cubic, rules }));
    pointer.pointerDown(sample(0, 0));
    // 1 + 3 · 11000 points: a whole chain, past the limit.
    for (let i = 1; i < 33000; i++) pointer.pointerMove(sample(i % 50, i % 70));
    pointer.pointerUp(sample(7, 7));
    const stroke = pointer.takeCommitted()!;
    expect(stroke.points.length).toBeLessThanOrEqual(MAX_STROKE_COORDS);
    expect((stroke.points.length - 2) % 6).toBe(0);
  });

  it('a brush that hands back half a curve lays nothing down', () => {
    const rules: StrokeRules = {
      capture: (_line, batch) => [...batch],
      commit: (points, descriptor) => ({ points: points.slice(0, 4), tool: descriptor }),
    };
    const pointer = new PointerStrokeController(() => ({ descriptor: cubic, rules }));
    pointer.pointerDown(sample(0, 0));
    pointer.pointerMove(sample(10, 10));
    pointer.pointerMove(sample(20, 0));
    pointer.pointerUp(sample(30, 10));
    expect(pointer.takeCommitted()).toBeNull();
  });
});

describe('a plugin write the format has no room for', () => {
  it('is refused on the canvas, not thrown into the plugin', () => {
    // The throw went back through host.edit into the plugin's move, whose
    // guard took it for the plugin's own fault and switched the plugin off.
    const edit = method('editPluginCells');
    expect(edit).toMatch(/catch \(err\) \{[^]*this\.refuseAtLimit\(err\)/);
  });

  it('leaves no cell half written', () => {
    // The first layer was written, the second refused, and nothing filed the
    // first one as a step of undo.
    const edit = method('editPluginCells');
    expect(edit).toContain('const before = ');
    expect(edit.indexOf('const before = ')).toBeLessThan(edit.indexOf('replaceStrokes'));
  });
});

describe('cutting the timeline selection leaves a hidden layer alone', () => {
  it('Ctrl+X asks mayEdit for every selected layer', () => {
    // Paste into a hidden layer is refused, and the cut emptied it.
    expect(method('cutSelection')).toContain('this.mayEdit(this.selection.layers)');
  });
});

describe('the tool in hand does not outlive its plugin', () => {
  it('the pencil comes back even when its key is off the panel', () => {
    // selectTool('pencil') refused a pencil the arrangement had hidden, and
    // the removed plugin's tool stayed in hand with its window open.
    const refresh = method('refreshPlugins');
    expect(refresh).toContain("[...this.availableTools, 'pencil']");
    expect(refresh).toContain('this.closePluginWindow()');
  });

  it('the way back from a help tool is not a tool that is gone', () => {
    expect(method('refreshPlugins')).toContain('plugins.tool(this.previousDrawingTool)');
  });

  it('a tool picked again is not activated a second time', () => {
    // activate ran on every press of the key; deactivate only on a change.
    // The switch moved into hold(), shared with the pipette's way back
    // (sixteenth audit); the same tool again returns before either call.
    expect(method('selectTool')).toContain('this.hold(resolved)');
    const hold = method('hold');
    const same = hold.indexOf('if (tool === this.tool) {');
    expect(same).toBeGreaterThan(-1);
    expect(hold.indexOf('deactivate?.(')).toBeGreaterThan(same);
    expect(hold).toMatch(/deactivate[^]*closePluginWindow\(\);[^]*activate\?\.\(/);
  });
});

describe('a draft reopened with the transform in hand', () => {
  it('goes back to its frame first, and opens no transform', () => {
    // The lasso took the first frame on open; with the lock on, going to the
    // saved frame was then refused and the studio said «Сначала примени…».
    const restore = method('restoreState');
    expect(restore.indexOf('this.selectFrame(')).toBeLessThan(restore.indexOf('this.selectTool('));
    expect(restore).toContain("saved.tool !== 'lasso'");
  });
});

describe('the preview does not play over an open transform', () => {
  it('play applies the transform first, or does not start under the lock', () => {
    // «Применить» pressed during the preview closed the window and wrote
    // nothing: applyTransform refuses while playing.
    expect(play).toMatch(/function play\([^]*?if \(!editor\.leaveTransform\(\)\) \{\s*return;/);
  });

  it('apply during playback keeps the session rather than dropping it', () => {
    const commit = method('commitTransform');
    expect(commit.indexOf('this.playing')).toBeLessThan(commit.indexOf('this.transform = null'));
  });
});

describe('the mega eraser knows a stamped row without the plugin that stamps it', () => {
  it('with no tool declaring a cut, a row of cells loses cells, not a polyline piece', () => {
    // A stamp is a primitive of the format, like the contour the eraser knows
    // by itself. With the bundled plugin off, a row was cut as a line: the
    // cut ends landed between cells and the row slid off its grid.
    const tools = [stamp(10)];
    const pieces = eraseStrokes([{ points: [0, 0, 100, 0], tool_id: 0 }], [55, 5], 6, tools);
    expect(pieces.length).toBe(2);
    for (const piece of pieces) {
      expect(piece.points.every((v) => v % 10 === 0)).toBe(true);
    }
  });
});

describe('undo and redo name the chord that works with the letter keys off', () => {
  it('the titles keep Ctrl+Z when the bare Z goes', () => {
    // With single-letter keys off, «Отменить (Z)» became a title with no key
    // at all, though Ctrl+Z still undoes.
    expect(withoutLetterKeys(t('editor.undo_title'))).toContain('Ctrl+Z');
    expect(withoutLetterKeys(t('transform.undo'))).toContain('Ctrl+Z');
  });

  it('the keys tell a reader their shortcuts, as the tool keys do', () => {
    expect(editorUi).toContain("aria-keyshortcuts={editor.settings.letterKeys ? 'Z Control+Z' : 'Control+Z'}");
    expect(editorUi).toContain("aria-keyshortcuts={editor.settings.letterKeys ? 'Y Control+Shift+Z' : 'Control+Shift+Z'}");
  });
});
