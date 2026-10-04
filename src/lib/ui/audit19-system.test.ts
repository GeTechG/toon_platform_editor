import { describe, expect, it } from 'bun:test';

// Nineteenth audit, the small screens and the shared system. Read as source,
// like audit18-system: the sums are in the comments, measured in Chrome at
// 320×568 and 390×844, at 100 and 200 % text.
const UI = new URL('./', import.meta.url).pathname;
const paletteUi = await Bun.file(UI + 'PaletteBox.svelte').text();
const pickerUi = await Bun.file(UI + 'ColourPicker.svelte').text();
const rule = (selector: string, from: string) => {
  const at = from.indexOf(`${selector} {`);
  return at < 0 ? '' : from.slice(at, from.indexOf('}', at));
};

describe('the press boxes on the two big swatches do not grow with the text', () => {
  // «+» and the swap key are drawn small and pressed a finger wide, by a box
  // laid over the swatch faces. In rem that box was 88 px at 200 % text: on a
  // phone's 76 px face the swap took the half by the seam and «+» the other,
  // 69 px tall both — with «+» up no point of the outline swatch opened the
  // colour window, and without it 42 % did. A finger is 44 px at any text.
  it('the box is the tap floor, in px', () => {
    const box = rule('.add::after,\n  .swap::after', paletteUi);
    expect(box).toMatch(/width:\s*var\(--tap, 44px\)/);
    expect(box).toMatch(/height:\s*var\(--tap, 44px\)/);
    expect(box).not.toContain('--key-h');
  });
});

describe('the picker’s bar is a finger deep under a finger', () => {
  // The hue strip is the reference's 31 px: every other slider of the studio
  // has a band a key deep, and the window's own «исходный» swatch grows to the
  // key under a coarse pointer. The strip did not — the one target of the
  // colour window under the floor. Its value is read off the box's width
  // alone, so a taller box only stretches the same columns.
  it('takes the tap floor where the pointer is coarse', () => {
    const coarse = pickerUi.slice(pickerUi.indexOf('@media (pointer: coarse) {\n    .bar'));
    const bar = coarse.slice(0, coarse.indexOf('\n  }\n'));
    expect(bar).toMatch(/height:\s*var\(--tap, 44px\)/);
    // A canvas given a height alone keeps its ratio: 250 px wide in a 204 px
    // window, which then scrolled sideways.
    expect(bar).toMatch(/width:\s*100%/);
  });
});
