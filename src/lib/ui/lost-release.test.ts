import { describe, expect, test } from 'bun:test';
import { createLostRelease } from './lost-release';

const move = (pointerType: string, buttons: number) => ({ pointerType, buttons });

describe('a drag let go where its release never came', () => {
  test('a mouse with no button held has let go', () => {
    const lost = createLostRelease();
    expect(lost(move('mouse', 1))).toBe(false);
    expect(lost(move('mouse', 0))).toBe(true);
  });

  test('a pen blank for one move mid-drag is still down (Firefox, Wacom, Windows)', () => {
    const lost = createLostRelease();
    expect(lost(move('pen', 1))).toBe(false);
    expect(lost(move('pen', 0))).toBe(false);
    expect(lost(move('pen', 1))).toBe(false);
    expect(lost(move('pen', 0))).toBe(false);
  });

  test('a pen blank for two moves running hovers: it has let go', () => {
    const lost = createLostRelease();
    expect(lost(move('pen', 0))).toBe(false);
    expect(lost(move('pen', 0))).toBe(true);
  });

  test('a finger has no hover and never lets go this way', () => {
    const lost = createLostRelease();
    expect(lost(move('touch', 0))).toBe(false);
    expect(lost(move('touch', 0))).toBe(false);
  });

  test('a release that came clears the blank for the next drag', () => {
    const lost = createLostRelease();
    expect(lost(move('pen', 0))).toBe(false);
    lost.reset();
    expect(lost(move('pen', 0))).toBe(false);
  });

  test('the drag may count only the main button', () => {
    const lost = createLostRelease();
    expect(lost(move('mouse', 2), (b) => (b & 1) === 0)).toBe(true);
  });
});

const source = (name: string) => Bun.file(new URL(`./${name}`, import.meta.url)).text();

describe('every drag of the studio asks the same guard', () => {
  test.each([
    ['Editor.svelte', 'lostRelease(e)', 'resize = {'],
    ['PanelArranger.svelte', 'lostRelease(e)', 'drag = {'],
    ['draggable.ts', 'lostRelease(e)', 'grab = {'],
    ['LayerRows.svelte', 'lostRelease(e, mainUp)', 'drag = {'],
    ['Timeline.svelte', 'lostCell(e, mainUp)', 'dragging = true'],
    ['Timeline.svelte', 'lostCol(e, mainUp)', 'colDrag = {'],
  ])('%s: %s', async (file, call, start) => {
    const text = await source(file);
    expect(text).toContain(call);
    expect(text).not.toContain("e.pointerType !== 'touch' && e.buttons === 0");
    expect(text).not.toContain('!(e.buttons & 1)');
    // The drag starts clean: a blank move left by the last one does not count.
    const guard = call.slice(0, call.indexOf('('));
    expect(text.slice(text.indexOf(start) - 200, text.indexOf(start))).toContain(`${guard}.reset()`);
  });
});
