import { describe, expect, it } from 'bun:test';

// Toonop's own colours held no pipette (owner, 2026-10-13: «давай пипетку
// добавить в цвета»): the key stands in the heading beside the two colours
// in hand and takes into the one that is pressed.
const panel = await Bun.file(new URL('./ColoursPanel.svelte', import.meta.url)).text();
const header = panel.slice(panel.indexOf('<header>'), panel.indexOf('</header>'));

describe('the colours panel has a pipette', () => {
  it('a key in the heading, pressed while the pipette is in hand', () => {
    expect(header).toMatch(/aria-pressed=\{editor\.tool === 'pipette'\}[^]*?<Icon name="pipette" \/>/);
  });

  it('takes into the colour being chosen, outline or fill', () => {
    expect(header).toContain("editor.selectTool('pipette', target)");
  });
});
