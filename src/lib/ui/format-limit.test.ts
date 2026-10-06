import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { budgetLabel } from './format-limit';

describe('the budget in the layer column', () => {
  it('says how full the mult is, as a whole percent', () => {
    const label = budgetLabel(0.376);
    expect(label.text).toMatch(/^37\s%$/);
    expect(label.title).toMatch(/^Мульт заполнен на 37\s%$/);
    expect(label.tight).toBe(false);
  });

  it('never says 100 % while a stroke still fits', () => {
    expect(budgetLabel(0.9996).text).toMatch(/^99\s%$/);
    expect(budgetLabel(1).text).toMatch(/^100\s%$/);
  });

  it('turns tight from 80 %, and says what to do about it', () => {
    expect(budgetLabel(0.79).tight).toBe(false);
    const label = budgetLabel(0.8);
    expect(label.tight).toBe(true);
    expect(label.title).toMatch(/^Мульт заполнен на 80\s% — места осталось мало$/);
  });
});

// EditorState is a runes class, so its part is asserted as source.
describe('a frame or a layer the budget has no room for', () => {
  const state = readFileSync(new URL('./editor-state.svelte.ts', import.meta.url), 'utf8');

  it('is refused aloud, not thrown: all three ways in go through #writeIfRoom', () => {
    for (const op of ['addLayer(doc, at)', 'addFrame(doc, this.activeFrame)', 'insertFrameBefore(doc, this.activeFrame)']) {
      expect(state).toContain(`this.#writeIfRoom((doc) => ${op})`);
    }
  });
});
