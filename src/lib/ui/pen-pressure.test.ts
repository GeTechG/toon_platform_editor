import { describe, expect, it } from 'bun:test';

/**
 * The canvas and the state are Svelte components/runes classes that cannot be
 * instantiated here, so their share of pen pressure is asserted on the source,
 * the way the rest of their contract is (see `document-holder.test.ts`).
 */
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const canvas = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();

describe('pen pressure in the editor', () => {
  it('survives the undo snapshot of a cell', () => {
    const snapshot = state.match(/private snapshotCells[^]*?\n {2}}/)?.[0] ?? '';
    expect(snapshot).toContain('pressureOf(s)');
  });

  it('is read only from a pen, and only while the setting is on', () => {
    const sample = canvas.match(/function toPointerSample[^]*?\n {2}}/)?.[0] ?? '';
    expect(sample).toContain("e.pointerType === 'pen' && editor.settings.penPressure");
  });

  it('is drawn on the line under the hand as well', () => {
    expect(canvas).toContain('previewStrokePressure(session');
  });
});
