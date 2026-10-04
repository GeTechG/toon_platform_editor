import { describe, expect, it } from 'bun:test';

// Twentieth audit, the brush.
const panel = await Bun.file(new URL('./BrushPanel.svelte', import.meta.url)).text();

describe('поле-число панели кисти не у́же пальца', () => {
  // A phone 320 wide at 200 % text leaves the box 132px inside: a third of it
  // is 42, two under the 44 floor. The field holds its floor and the track
  // gives the two pixels up.
  it('колонка числа — не меньше 44px, колонка дорожки отдаёт место', () => {
    const box = panel.slice(panel.indexOf('.brush-box {'), panel.indexOf('}', panel.indexOf('.brush-box {')));
    expect(box).toMatch(/grid-template-columns: minmax\(0, 2fr\) minmax\(44px, 1fr\);/);
  });
});
