import { describe, expect, it } from 'bun:test';
import { EMPTY_TRANSFORM, scaledBy } from '../tools/lasso';

// Sixteenth audit, tools: a handle that shrank a mirrored selection when it
// was dragged outwards, a pipette that handed a plugin tool back without its
// window, a copy that took the drawing from under a live move, and a lasso
// that showed the brush ring where a press only takes the frame.
// The store and the canvas are runes components, so they are asserted as
// source, like audit15; the geometry is pure and runs.
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const canvas = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();

function method(name: string): string {
  const match = state.match(new RegExp(`\\n  (?:get |private )?${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

const box = { x: 0, y: 0, width: 100, height: 50 };

describe('a handle of a mirrored selection grows it when dragged outwards', () => {
  it('the right handle after H', () => {
    // The handle sits where it sat before the mirror, but the travel was
    // added to a negative scale: dragged outwards, the selection shrank.
    const mirrored = { ...EMPTY_TRANSFORM, scaleX: -1 };
    const s = scaledBy(mirrored, box, 'scale-r', { x: 100, y: 25 }, { x: 150, y: 25 }, false);
    expect(s.scaleX).toBeCloseTo(-2, 6);
    expect(s.scaleY).toBe(1);
  });

  it('the bottom handle after Shift+H, and past the centre it flips back', () => {
    const mirrored = { ...EMPTY_TRANSFORM, scaleY: -1 };
    expect(scaledBy(mirrored, box, 'scale-d', { x: 50, y: 50 }, { x: 50, y: 75 }, false).scaleY).toBeCloseTo(-2, 6);
    // Dragged up past the centre, as far as the unmirrored one would go to -1.5.
    expect(scaledBy(mirrored, box, 'scale-d', { x: 50, y: 50 }, { x: 50, y: -12.5 }, false).scaleY).toBeCloseTo(1.5, 6);
  });

  it('a corner of a mirrored selection keeps its ratio under Shift', () => {
    const mirrored = { ...EMPTY_TRANSFORM, scaleX: -1 };
    const s = scaledBy(mirrored, box, 'scale-dr', { x: 100, y: 50 }, { x: 125, y: 50 }, true);
    expect(s.scaleX).toBeCloseTo(-1.5, 6);
    expect(s.scaleY).toBeCloseTo(1.5, 6);
  });
});

describe('the pipette hands a plugin tool back whole', () => {
  it('the way back runs the same switch as a pick: deactivate, window, activate', () => {
    // resetHelpTool wrote the tool straight in: a plugin tool picked before
    // the pipette came back without its activate, so without its window, and
    // its next deactivate had no activate to pair with.
    const back = method('resetHelpTool');
    expect(back).not.toMatch(/this\.tool = /);
    expect(back).toContain('this.hold(');
    const hold = method('hold');
    expect(hold).toContain('deactivate?.(');
    expect(hold).toContain('this.closePluginWindow()');
    expect(hold).toContain('activate?.(');
    expect(method('selectTool')).toContain('this.hold(resolved)');
  });
});

describe('a copy during a live move takes what the screen shows', () => {
  it('the cells are copied off the drawing with the transform in it', () => {
    // Ctrl+C with a moved selection copied the cells as they were before the
    // move: pasted elsewhere, the drawing came back where it had been. Cut
    // and paste apply the move first; a copy leaves it live.
    const copy = method('copySelection');
    expect(copy).toContain('copyCells(this.docWithTransform(), this.selection)');
  });
});

describe('the lasso shows no brush ring', () => {
  it('outside a handle it is the plain arrow, not the brush it does not draw with', () => {
    // With the lasso in hand and no handle under the pointer, the canvas hid
    // the arrow and drew the brush ring: a press there takes the frame, it
    // lays no line.
    const cursor = canvas.match(/const overlayCursor = \$derived\([^]*?\n  \);/)?.[0] ?? '';
    expect(cursor).toMatch(/editor\.tool === 'lasso'[^]*'default'/);
  });
});

describe('a pinch that begins on a live selection does not move it', () => {
  it('the handle the first finger dragged goes back when the second lands', () => {
    // The selection covers the drawing, so the first finger of a pinch
    // usually lands on it and drags it a little before the second arrives.
    // The pinch dropped the grab but kept the move, and the drawing stayed
    // shifted by a zoom.
    const drop = canvas.match(/function dropOwnGesture\(\): void \{[^]*?\n  }\n/)?.[0] ?? '';
    expect(drop).toMatch(/grab\?\.moved[^]*editor\.undoTransform\(\)/);
    expect(drop.indexOf('undoTransform')).toBeLessThan(drop.indexOf('grab = null'));
  });
});

const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const ru = await Bun.file(new URL('../i18n/ru.json', import.meta.url)).json();

describe('the manual names the keys of a live transform', () => {
  const table = editorUi.slice(editorUi.indexOf('const SHORTCUTS'), editorUi.indexOf(']);', editorUi.indexOf('const SHORTCUTS')));

  it('turning, applying and cancelling are listed where the lasso is', () => {
    // The handler turns a selection on Q / W, applies on Enter and drops on
    // Esc, and moves and scales it on the arrows and + / −; the manual, which
    // says it mirrors the handler, named none of it.
    expect(table).toContain("has('lasso') && ['Q / W', t('key.transform_turn')]");
    expect(table).toContain("has('lasso') && ['Enter / Esc', t('key.transform_apply')]");
    expect(ru.key.transform_turn).toContain('15°');
    expect(ru.key.transform_apply).toContain('трансформ');
    expect(ru.key.steps).toContain('в трансформации');
    expect(ru.key.brush_size).toContain('в трансформации');
  });
});

const menu = await Bun.file(new URL('./TransformMenu.svelte', import.meta.url)).text();

describe('the transform window\'s step keys keep the focus at the end of the steps', () => {
  it('undo and redo are aria-disabled and do nothing there, not disabled', () => {
    // «Шаг назад» pressed down to the first step went disabled under the
    // hand and the focus fell to <body> (WCAG 2.4.3), as the zoom keys did.
    expect(menu).not.toMatch(/\sdisabled=\{!editor\.can(Undo|Redo)Transform\}/);
    expect(menu).toContain('aria-disabled={!editor.canUndoTransform}');
    expect(menu).toContain('aria-disabled={!editor.canRedoTransform}');
    expect(menu).toMatch(/\.step\[aria-disabled='true'\][^}]*opacity/);
  });
});
