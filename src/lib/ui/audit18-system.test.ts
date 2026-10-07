import { describe, expect, it } from 'bun:test';

// Eighteenth audit, the small screens and the shared system. Read as source,
// like audit17-system: the sums are in the comments, from the rules' own
// numbers at 320×568, 390×844 and 844×390, at 100 and 200 % text.
const UI = new URL('./', import.meta.url).pathname;
const editorUi = await Bun.file(UI + 'Editor.svelte').text();
const paletteUi = await Bun.file(UI + 'PaletteBox.svelte').text();
const rule = (selector: string, from = editorUi) => {
  const at = from.indexOf(`${selector} {`);
  return at < 0 ? '' : from.slice(at, from.indexOf('}', at));
};

describe('a note on a small stage keeps clear of the zoom window and the rail', () => {

});

describe('a note is never wider than the stage it lies on', () => {
  // 92 % of the stage and then the padding and the border on top: 267 px on
  // a 260 px stage, and the × of the import error was cut at the edge.
  it('the padding counts inside the 92 %', () => {
    expect(rule('.import-error')).toMatch(/box-sizing:\s*border-box/);
    expect(rule('.stage-note')).toMatch(/box-sizing:\s*border-box/);
  });
});

describe('the palette grid shows as many rows whatever the cell', () => {
  // The cells went to rem and, under a finger, to the key's height; the
  // window they scroll in stayed 120 px — 3.75 rows for a mouse, 2.7 for a
  // finger, 1.4 at 200 % text.
  it('the window is in the cell’s own unit', () => {
    expect(rule('.grid', paletteUi)).toMatch(/max-height:\s*7\.5rem/);
    const coarse = paletteUi.slice(paletteUi.indexOf('@media (pointer: coarse) {\n    .grid'));
    expect(coarse.slice(0, coarse.indexOf('\n  }\n'))).toMatch(/max-height:\s*calc\(3\.75 \* var\(--key-h, 2\.75rem\)\)/);
  });
});
