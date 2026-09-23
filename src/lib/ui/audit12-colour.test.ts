import { describe, expect, it } from 'bun:test';
import { pressesCell } from './color-palette';

const read = (name: string) => Bun.file(new URL(name, import.meta.url)).text();
const picker = await read('./ColourPicker.svelte');
const palette = await read('./PaletteBox.svelte');

describe('twelfth audit: colour', () => {
  it('a mouse presses a cell on the way down, a pen and a finger on release', () => {
    // A pen sends its compat mousedown at contact: its long press put the
    // colour on the outline and then on the fill, and in remover mode the
    // contextmenu that followed took the cell that slid under the tip too.
    expect(pressesCell('mousedown', 'mouse', 1)).toBe(true);
    expect(pressesCell('click', 'mouse', 1)).toBe(false);
    expect(pressesCell('mousedown', 'pen', 1)).toBe(false);
    expect(pressesCell('click', 'pen', 1)).toBe(true);
    expect(pressesCell('mousedown', 'touch', 1)).toBe(false);
    expect(pressesCell('click', 'touch', 1)).toBe(true);
    // A key's click has no detail and presses whatever touched the grid last.
    expect(pressesCell('click', 'pen', 0)).toBe(true);
    expect(pressesCell('click', 'mouse', 0)).toBe(true);
  });

  it('both grids of the palette box ask pressesCell, with the pointer that went down', () => {
    for (const grid of [
      palette.match(/<div class="grid" class:remover[\s\S]*?<\/div>/)?.[0] ?? '',
      palette.match(/<div class="grid preview-grid"[\s\S]*?<\/div>/)?.[0] ?? '',
    ]) {
      expect(grid).toMatch(/onpointerdown=\{\(e\) => \(pointerKind = e\.pointerType\)\}/);
      expect(grid).toMatch(/onmousedown=\{\(e\) => pressesCell\('mousedown', pointerKind, e\.detail\)/);
      expect(grid).toMatch(/onclick=\{\(e\) => pressesCell\('click', pointerKind, e\.detail\)/);
      expect(grid).not.toContain('e.detail === 0 &&');
    }
  });

  it('the field pointer and the bar knob keep their ring in forced colors', () => {
    // The ring is a box-shadow, which forced colors drop: a white-bordered dot
    // on the white corner of the field was gone.
    const forced = picker.match(/@media \(forced-colors: active\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
    expect(forced).toMatch(/\.dot,\s*\.knob\s*\{\s*forced-color-adjust: none;/);
  });

  it('only the primary button drives the field and the bar', () => {
    // A right click moved the colour and then opened «Сохранить изображение».
    const drag = picker.match(/function drag\([\s\S]*?\n  \}/)?.[0] ?? '';
    expect(drag).toMatch(/if \(e\.button !== 0\) return;/);
    const move = picker.match(/function move\([\s\S]*?\n  \}/)?.[0] ?? '';
    expect(move).toMatch(/\(e\.buttons & 1\) === 0 && e\.type === 'pointermove'/);
  });

  it('a saved palette tile says whether its preview is open', () => {
    const tile = palette.match(/<button\s+class="tile"\s+data-id[\s\S]*?>/)?.[0] ?? '';
    expect(tile).toMatch(/aria-expanded=\{preview\?\.id === p\.id\}/);
  });
});
