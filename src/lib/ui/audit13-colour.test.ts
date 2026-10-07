import { describe, expect, it } from 'bun:test';
import { parseColourInput } from './color-model';
import { colorToPointer, nudgePointer, pointerToColor, pointerToRgb, type PickerModel } from './picker-model';

const read = (name: string) => Bun.file(new URL(name, import.meta.url)).text();
const picker = await read('./ColourPicker.svelte');
const palette = await read('./PaletteBox.svelte');
const panel = await read('./ColorPanel.svelte');

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
/** A spread of colours: every 17th step of each channel, greys and the corners included. */
const SAMPLE: string[] = [];
for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 17) SAMPLE.push(hex(r, g, b));
SAMPLE.push('#000006', '#010203', '#123456', '#fefefe', '#7f7f80');

const rule = (source: string, selector: string) =>
  source.match(new RegExp(`\\n  ${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[^}]*\\}`))?.[0] ?? '';

describe('thirteenth audit: colour', () => {
  it('a colour read into the window is the colour the window gives back', () => {
    // The pointer took hue, saturation and value rounded to whole units: 86%
    // of colours came back one step off, so a single arrow press and its
    // opposite (or a model switch and a nudge) moved the colour for nothing.
    for (const model of ['hsv', 'rgb', 'wheel'] as PickerModel[]) {
      for (const c of SAMPLE) expect(`${model} ${pointerToColor(model, colorToPointer(model, c))}`).toBe(`${model} ${c}`);
    }
  });

  it('an arrow press and its opposite leave the colour where it was', () => {
    for (const model of ['hsv', 'wheel'] as PickerModel[]) {
      for (const c of SAMPLE) {
        const p = colorToPointer(model, c);
        // Away from the bar's ends, where the clamp rightly eats the first press.
        if (p.bar <= 0.02 || p.bar >= 0.98) continue;
        const there = nudgePointer(model, p, 'ArrowUp', { target: 'bar' });
        const back = nudgePointer(model, there, 'ArrowDown', { target: 'bar' });
        expect(`${model} ${pointerToColor(model, back)}`).toBe(`${model} ${c}`);
      }
    }
  });

  it('the canvases paint from channels, not from a hex string per pixel', () => {
    expect(pointerToRgb('hsv', { x: 1, y: 0, bar: 0 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(pointerToRgb('rgb', { x: 0.2, y: 0.5, bar: 1 })).toEqual({ r: 255, g: 128, b: 51 });
    const paint = picker.match(/function paint\([\s\S]*?\n  \}/)?.[0] ?? '';
    expect(paint).toContain('pointerToRgb(');
    expect(paint).not.toContain('hexToRgb(pointerToColor(');
  });

  it('a hex with an alpha is read, and the alpha dropped, as rgba() already was', () => {
    expect(parseColourInput('#ff000080')).toBe('#ff0000');
    // Four digits stay unfinished typing of six (owner-twelfth-colour).
    expect(parseColourInput('#F008')).toBeNull();
    expect(parseColourInput('336699cc')).toBe('#336699');
    // Five and seven digits are still unfinished typing.
    expect(parseColourInput('#ff000')).toBeNull();
    expect(parseColourInput('#ff00008')).toBeNull();
  });

  it('the field and the bar ring their focus outside the drawn colour', () => {
    // Inset, the red ring vanished over the red end of the hue strip and the
    // red side of the field.
    const ring = picker.match(/\.surface:focus-visible,\s*\.bar:focus-visible\s*\{[^}]*\}/)?.[0] ?? '';
    expect(ring).toMatch(/outline-offset: 2px;/);
  });

  it('«add» and swap on the big swatches ring their focus in a colour that is not the swatch', () => {
    // The accent ring over a red swatch was red on red.
    expect(palette).toMatch(/\.add:focus-visible\s*\{\s*outline: 3px solid currentColor;/);
    const swap = palette.match(/\.swap:focus-visible\s*\{[^}]*\}/)?.[0] ?? '';
    expect(swap).toMatch(/outline-offset: -3px;/);
    expect(palette).not.toMatch(/\.add:focus-visible,\s*\.swap:focus-visible/);
  });

  it('the strip of saved colours rings a cell inside it, where its scroller does not clip', () => {
    // overflow-x: auto clips the other axis too: a ring outside the cell lost its top and bottom.
    expect(rule(panel, '.cell:focus-visible')).toMatch(/outline: 3px solid currentColor;\s*outline-offset: -3px;/);
    expect(rule(panel, '.cell.active')).toMatch(/inset 0 0 0 2px var\(--accent\)/);
    expect(panel).toMatch(/class="cell"[\s\S]*?style:color=\{contrastInk\(color\)\}/);
  });

  it('only the primary button drags the colour window, and a lost capture ends the drag', () => {
    const drag = picker.match(/function dragWindow\([\s\S]*?\n  \}/)?.[0] ?? '';
    expect(drag).toMatch(/if \(e\.button !== 0/);
    expect(drag).toContain("'lostpointercapture'");
  });

  it('a focused saved palette looks different from the open one', () => {
    expect(rule(palette, '.tile:focus-visible')).toMatch(/outline-offset: 2px;/);
  });

  it('in remover mode a cell is a delete key, not a pressed toggle', () => {
    expect(palette).toMatch(/aria-pressed=\{removerMode \? undefined : isOutline \|\| isFill\}/);
  });
});

// 2026-10-08 critique: «Цвет» dropped into a side column kept its one row —
// 30 swatches, 1407px of them in 226, five to be seen and no scrollbar to say
// there were more. A column has the height a row has not: there they wrap.
describe('the strip of saved colours in a side column', () => {
  it('wraps instead of scrolling sideways', () => {
    const side = panel.match(/\n  :global\(:where\(\[data-slot='left'\], \[data-slot='right'\]\)\) \.grid \{[^}]*\}/)?.[0] ?? '';
    expect(side).toContain('flex-wrap: wrap');
    expect(side).toContain('max-width: none');
    expect(side).toContain('overflow-x: visible');
    // After the row's own rule: the two weigh the same, and the later one wins.
    expect(panel.indexOf(side)).toBeGreaterThan(panel.indexOf('\n  .grid {'));
  });
});
