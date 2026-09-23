import { describe, expect, it } from 'bun:test';

/**
 * The document is held as a value, not as a reactive proxy.
 *
 * Svelte's `$state` proxies an object all the way down — layers, frames,
 * strokes and every index of a points array, each with a signal of its own.
 * On the real render path that measured 35× slower than a plain document, and
 * the signals stay in memory for as long as the drawing does. So the holder is
 * `$state.raw`, and a write is announced by replacing the value.
 *
 * `EditorState` is a runes class and cannot be instantiated here, so the
 * invariant is asserted on the source — the same way the rest of the state's
 * contract is (see `layers-panel.test.ts`).
 */
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();

/**
 * Operations that only read the document. Everything else that takes it must
 * go through the write path, which is what replaces the holder — a mutation
 * on `this.doc` in place would leave the canvas showing the frame before it.
 */
const READ_ONLY = new Set([
  'frameCount',
  'isEmptyDocument',
  'cloneColumn',
  'copyCells',
  'pasteNeedsConfirm',
  'onionLayers',
  'onionHistoryLayers',
  'takeStructure',
  'structureIntact',
  'seal',
  'copiedMarks',
  'isMarked',
  'isFrameMarked',
]);

/** The body of the one method that writes to the document. */
const writePath = state.match(/ {2}#write<T>\([^]*?\n {2}}/)?.[0] ?? '';

describe('the document is a value', () => {
  it('is held raw, not proxied', () => {
    expect(state).toContain('doc = $state.raw(');
  });

  it('announces a write by replacing the holder', () => {
    // One place does it, so no mutator can forget to.
    expect(writePath).toContain('this.doc = { ...this.doc }');
  });

  it('keeps what remembers cells of the document raw as well', () => {
    // Undo and redo ask "is this still the very cell I took the stroke off?"
    // by identity. A `$state` array proxies what is put into it, so a cell
    // parked in the history would stop being equal to the cell in the
    // document — redo would never be offered again.
    for (const held of ['edits', 'undone', 'copiedCells', 'copiedColumn']) {
      expect(state).toContain(`${held} = $state.raw`);
    }
  });

  it('hands the document to a mutating operation only through the write path', () => {
    // `this.doc` reaching an operation directly is the shape of a write that
    // nobody will hear: the holder stays the same value and the frame stands.
    // The write path itself hands the document on; everywhere else must not.
    const direct = [...state.replace(writePath, '').matchAll(/(\w+)\(this\.doc\s*[,)]/g)]
      .map((match) => match[1])
      .filter((name) => !READ_ONLY.has(name));
    expect([...new Set(direct)]).toEqual([]);
  });
});
