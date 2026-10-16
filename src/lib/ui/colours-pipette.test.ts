import { describe, expect, it } from 'bun:test';

// Toonop's own colours held no pipette (owner, 2026-10-13: «давай пипетку
// добавить в цвета»): the key stands in the heading beside the two colours
// in hand and takes into the one that is pressed.
const panel = await Bun.file(new URL('./ColoursPanel.svelte', import.meta.url)).text();
const header = panel.slice(panel.indexOf('<header>'), panel.indexOf('</header>'));

describe('the colours panel has a pipette', () => {
  it('a key in the heading, pressed while the pipette is in hand', () => {
    expect(header).toMatch(/aria-pressed=\{editor\.tool === 'pipette'\}[^]*?<Icon name="pipette" size=\{20\} \/>/);
  });

  it('takes into the colour being chosen, outline or fill', () => {
    expect(header).toContain("editor.selectTool('pipette', target)");
  });
});

// Behind a key the panel is a plate over the sheet, and the pipette picked in
// it had the plate between itself and the drawing. It stood aside and came
// back at first; the owner then (2026-10-13): «после того как выбрал цвет,
// можно закрыть попап, чтобы сразу кисть была выбрана» — it shuts.
describe('the colours plate shuts when the pipette is picked', () => {
  it('the key shuts its box as the pipette comes into hand, and does not open it again', async () => {
    const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
    expect(editorUi).toMatch(/<PopKey label=\{t\('colours\.key'\)\}[^>]*shutOn=\{PIPETTE_LIKE\.includes\(editor\.tool\)\}/);
    const pop = await Bun.file(new URL('./PopKey.svelte', import.meta.url)).text();
    expect(pop).not.toContain('away?: boolean');
  });
});
