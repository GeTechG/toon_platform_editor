import { describe, expect, test } from 'bun:test';
import { insertIndex, type Box } from './arrange';

/** A row of three 40px-wide boxes at y 0..40. */
const row: Box[] = [
  { left: 0, top: 0, right: 40, bottom: 40 },
  { left: 40, top: 0, right: 80, bottom: 40 },
  { left: 80, top: 0, right: 120, bottom: 40 },
];
/** The same three, stacked. */
const column: Box[] = [
  { left: 0, top: 0, right: 40, bottom: 40 },
  { left: 0, top: 40, right: 40, bottom: 80 },
  { left: 0, top: 80, right: 40, bottom: 120 },
];

describe('where a dragged item lands', () => {
  test('an empty panel takes it first', () => {
    expect(insertIndex([], 10, 10)).toBe(0);
  });

  test('a row reads left to right', () => {
    expect(insertIndex(row, 5, 20)).toBe(0);
    expect(insertIndex(row, 45, 20)).toBe(1);
    expect(insertIndex(row, 75, 20)).toBe(2);
    expect(insertIndex(row, 200, 20)).toBe(3);
  });

  test('a column reads top to bottom', () => {
    expect(insertIndex(column, 20, 5)).toBe(0);
    expect(insertIndex(column, 20, 45)).toBe(1);
    expect(insertIndex(column, 20, 300)).toBe(3);
  });

  test('the pointer is measured along the side it is furthest from the middle on', () => {
    // Past the right edge of a tall, narrow box: that is "after", even though
    // the pointer is a little above its middle.
    expect(insertIndex([{ left: 0, top: 0, right: 20, bottom: 200 }], 19, 90)).toBe(1);
    expect(insertIndex([{ left: 0, top: 0, right: 20, bottom: 200 }], 10, 5)).toBe(0);
  });
});

// --- Wiring ---------------------------------------------------------------
// Svelte/runes glue is asserted as source (the contract style this folder
// uses); the geometry above runs for real.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const arranger = await Bun.file(new URL('./PanelArranger.svelte', import.meta.url)).text();
const floatWindow = await Bun.file(new URL('./FloatWindow.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();

describe('arranging happens in the editor itself', () => {
  test('the mode is a flag on the state, not a stored setting', () => {
    expect(state).toContain('arranging = $state(false)');
    expect(state).toContain('floatPos = $state');
  });

  test('every panel is a drop target and every item is a handle', () => {
    for (const slot of ['left', 'right', 'bottom', 'bar', 'draw']) {
      expect(editorUi).toContain(`data-slot="${slot}"`);
    }
    expect(editorUi).toContain('data-item={id}');
    expect(editorUi).toContain('editor.arranging');
  });

  test('the drag is pointer events, so it works on a touch screen', () => {
    expect(arranger).toContain('pointerdown');
    expect(arranger).toContain('pointermove');
    expect(arranger).toContain('pointerup');
    expect(arranger).not.toContain('dragstart');
    expect(arranger).toContain('insertIndex(');
    expect(arranger).toContain('elementFromPoint');
    // Escape puts the arrangement back the way it was.
    expect(arranger).toContain("'Escape'");
  });

  test('a window dropped on the canvas floats, and remembers where', () => {
    expect(arranger).toContain("'float'");
    expect(floatWindow).toContain('clampWindowPosition');
    expect(floatWindow).toContain('setFloatPos');
  });
});

describe('named arrangements', () => {
  test('the state saves, applies and forgets a workspace', () => {
    expect(state).toContain('workspaces = $state');
    expect(state).toContain('saveWorkspace(');
    expect(state).toContain('applyWorkspace(');
    expect(state).toContain('deleteWorkspace(');
    // A stored workspace is a runes proxy; structuredClone refuses those.
    expect(state).toContain('$state.snapshot(workspace)');
  });

  test('the arrange bar picks one, names one and drops one', () => {
    expect(arranger).toContain('editor.applyWorkspace(');
    expect(arranger).toContain('editor.saveWorkspace(');
    expect(arranger).toContain('editor.deleteWorkspace(');
    // A name is typed in the bar, not into a browser prompt.
    expect(arranger).not.toContain('prompt(');
  });
});
