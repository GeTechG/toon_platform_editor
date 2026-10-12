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
// it had the plate between itself and the drawing (owner, 2026-10-13: «попап
// исчезает, пока идёт выбор, а то он мешает»).
describe('the colours plate stands aside while the pipette picks', () => {
  it('the key says so for as long as the pipette is in hand', async () => {
    const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
    expect(editorUi).toMatch(/<PopKey label=\{t\('colours\.key'\)\}[^>]*away=\{editor\.tool === 'pipette'\}/);
  });

  it('the plate is hidden, not shut: it comes back as it was left', async () => {
    const pop = await Bun.file(new URL('./PopKey.svelte', import.meta.url)).text();
    expect(pop).toContain('hidden={away}');
    // And a press on the sheet is the pick, not a press that closes the plate.
    expect(pop).toMatch(/if \(!shown\) return;\s*const elsewhere/);
  });
});
