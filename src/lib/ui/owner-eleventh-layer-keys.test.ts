import { describe, expect, it } from 'bun:test';
import { readId3 } from '../audio/track';
import { layerGridStep } from './frame-selection';

const rows = await Bun.file(new URL('./LayerRows.svelte', import.meta.url)).text();

// Every row was four Tab stops — eye, tag, name, bin — so twenty layers were
// eighty presses between the strip and whatever came next. The owner asked for
// what other editors do: the list is one stop, the arrows walk it (WAI-ARIA
// APG layout grid, roving tabindex); ↑/↓ pick a layer as Krita's PageUp/PageDown
// and Figma's arrows do, ←/→ walk the controls of the row.
describe('the layer list is one Tab stop', () => {
  it('↑ and ↓ walk the rows and keep the column', () => {
    expect(layerGridStep(2, 1, 'ArrowUp', 5, 4)).toEqual({ row: 1, col: 1 });
    expect(layerGridStep(2, 1, 'ArrowDown', 5, 4)).toEqual({ row: 3, col: 1 });
  });

  it('← and → walk the controls inside a row, without wrapping into the next', () => {
    expect(layerGridStep(0, 2, 'ArrowLeft', 5, 4)).toEqual({ row: 0, col: 1 });
    expect(layerGridStep(0, 2, 'ArrowRight', 5, 4)).toEqual({ row: 0, col: 3 });
    expect(layerGridStep(0, 0, 'ArrowLeft', 5, 4)).toBeNull();
    expect(layerGridStep(0, 3, 'ArrowRight', 5, 4)).toBeNull();
  });

  it('the edges stop the arrows, they do not wrap', () => {
    expect(layerGridStep(0, 2, 'ArrowUp', 5, 4)).toBeNull();
    expect(layerGridStep(4, 2, 'ArrowDown', 5, 4)).toBeNull();
  });

  it('Home and End reach the top and the bottom layer, as in Krita', () => {
    expect(layerGridStep(3, 2, 'Home', 5, 4)).toEqual({ row: 0, col: 2 });
    expect(layerGridStep(1, 2, 'End', 5, 4)).toEqual({ row: 4, col: 2 });
  });

  it('a column past a shorter row lands on its last control (one layer: no bin)', () => {
    expect(layerGridStep(0, 3, 'ArrowDown', 2, 3)).toEqual({ row: 1, col: 2 });
  });

  it('other keys are not the grid’s', () => {
    expect(layerGridStep(0, 0, 'a', 5, 4)).toBeNull();
  });

  it('the list is a grid of rows and cells, so a screen reader hands it the arrows', () => {
    expect(rows).toContain('role="grid"');
    expect(rows).toContain('role="row"');
    expect(rows).toContain('role="gridcell"');
    expect(rows).not.toContain('role="listitem"');
  });

  it('only one control of the whole list is in the Tab order', () => {
    for (const cls of ['eye', 'tag', 'name', 'kill']) {
      const button = rows.match(new RegExp(`<button\\s+class="${cls}"[\\s\\S]*?>`))?.[0] ?? '';
      expect(button).toMatch(/tabindex=\{stop\(layerIndex, \d\)\}/);
    }
  });

  it('the grid owns the keys, so F2, Alt+↑/↓ and Delete work from any control of the row', () => {
    expect(rows).toMatch(/role="grid"[^>]*onkeydown=\{onGridKey\}/);
    const onKey = rows.match(/function onGridKey[\s\S]*?\n  }/)?.[0] ?? '';
    expect(onKey).toContain("'F2'");
    expect(onKey).toContain('moveBy(');
    // Delete takes the layer, and the state asks «Удалить «Слой N»?» first.
    expect(onKey).toMatch(/'Delete'[\s\S]*?removeLayer\(/);
  });

  it('F2 on the eye, the tag or the bin hands the keyboard to the name field', () => {
    // autofocus only takes the focus from the name button it replaces; from
    // another cell the field opened and the typing went nowhere.
    const onKey = rows.match(/function onGridKey[\s\S]*?\n  }/)?.[0] ?? '';
    expect(onKey).toMatch(/startRename\(null, layerIndex\);[\s\S]*?\.rename'\)\?\.focus\(\)/);
  });

  it('the handle is a pointer affordance only and stays out of the grid’s cells', () => {
    expect(rows).toMatch(/class="handle"\s+aria-hidden="true"/);
  });
});

/** An ID3v2.4 tag of one TIT2 frame in text encoding 0. */
function latinTitle(text: number[]): ArrayBuffer {
  const data = [0, ...text];
  const body = [...'TIT2'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, data.length, 0, 0, ...data]);
  return Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, body.length, ...body]).buffer;
}

// Russian mp3s write UTF-8 (or cp1251) into the «latin1» encoding. Owner:
// «Ожидать utf8 иначе выводить как есть» — no cp1251 guessing.
describe('ID3 text encoding 0', () => {
  it('reads valid UTF-8 as UTF-8', () => {
    const utf8 = [...new TextEncoder().encode('Тест')];
    expect(readId3(latinTitle(utf8)).title).toBe('Тест');
  });

  it('falls back to latin1 when the bytes are not UTF-8', () => {
    // «Тест» in cp1251 is shown as it is, not guessed.
    expect(readId3(latinTitle([0xd2, 0xe5, 0xf1, 0xf2])).title).toBe('Òåñò');
  });

  it('plain ASCII stays itself', () => {
    expect(readId3(latinTitle([0x41, 0x42])).title).toBe('AB');
  });
});
