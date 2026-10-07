import { describe, expect, it } from 'bun:test';
import { panelByLayers } from './small-screen';
import { DEFAULT_DRAWING_UI_CONFIG, PANEL_HEIGHT_MIN, parseUiConfig } from './presets';

// Critique 2026-10-07: the bar's height was stored at its floor — the height
// of one layer — so «+ Слой» on a fresh studio slid «Слой 1» half under the
// frame numbers. Until a hand has dragged the divider, the bar stands as tall
// as its layers need (up to four; the rest scroll).
describe('the bottom bar stands by its layers until the divider is dragged', () => {
  it('one layer is the floor, each more adds its row, four is the most', () => {
    expect(panelByLayers(151, 1, 44)).toBe(151);
    expect(panelByLayers(151, 2, 44)).toBe(195);
    expect(panelByLayers(151, 4, 52)).toBe(307);
    expect(panelByLayers(151, 9, 44)).toBe(283);
  });

  const stored = (panelHeight: unknown) => parseUiConfig(JSON.stringify({
    preset: 'toonio',
    drawing: { activeProfile: 'toonio', tonio: {}, panelHeight },
  }))?.drawing.panelHeight;

  it('no height is stored until one is chosen', () => {
    expect(DEFAULT_DRAWING_UI_CONFIG.panelHeight).toBeNull();
    expect(stored(undefined)).toBeNull();
    expect(stored('tall')).toBeNull();
    expect(stored(240)).toBe(240);
  });

  // Every config written before this day carries the old default, the floor:
  // nobody chose it.
  it('the floor written by the old default is not a choice', () => {
    expect(stored(PANEL_HEIGHT_MIN)).toBeNull();
  });

  it('the drawn height takes the layers when nothing is stored', async () => {
    const shell = await Bun.file(new URL('./Editor.svelte', import.meta.url).pathname).text();
    expect(shell).toContain('yieldToCanvas(editor.panelHeight ?? panelByLayers(panelLow, editor.doc.layers.length, rowHeight(editor.doc)), panelLow, panelMax)');
  });
});
