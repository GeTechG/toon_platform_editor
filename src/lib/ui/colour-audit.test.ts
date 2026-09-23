import { describe, expect, it } from 'bun:test';
import { t } from '../i18n';

const read = (name: string) => Bun.file(new URL(name, import.meta.url)).text();
const picker = await read('./ColourPicker.svelte');
const palette = await read('./PaletteBox.svelte');
const panel = await read('./ColorPanel.svelte');

describe('the colour window speaks its model', () => {
  it('the help says what Shift really does', () => {
    // nudgePointer steps five with Shift; the label promised ten.
    expect(t('picker.field')).toContain('Shift — на пять');
  });

  it('the field and the bar read out in the model’s own terms', () => {
    // «поле 40 на 60» and a bare «Полоса 50» meant nothing to a listener.
    expect(t('picker.field_hsv', { color: '#ff0000', s: 100, v: 100 })).toBe('#ff0000: насыщенность 100%, яркость 100%');
    expect(t('picker.field_rgb', { color: '#ff0000', channel: t('picker.channel_r'), value: 255 })).toBe(
      '#ff0000: красный 255 из 255',
    );
    expect(picker).toContain('aria-valuetext={barReading.text}');
    expect(picker).not.toContain("t('picker.ramp')");
  });

  it('a drag repaints only the canvas it changes', () => {
    // Both canvases hung on the whole pointer: every move repainted two
    // 176-pixel-wide canvases pixel by pixel, one of them for nothing.
    expect(picker).not.toContain("$effect(() => paint(surface, 'surface', model, pointer));");
    expect(picker).toMatch(/void surfaceKey;/);
  });
});

describe('the palette grid answers every way of pressing', () => {
  it('a screen reader’s click takes the colour', () => {
    // The cells listened to mousedown and keydown only; a virtual cursor sends
    // a bare click (detail 0), and nothing happened.
    const grid = palette.match(/<div class="grid" class:remover[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(grid).toMatch(/onclick=\{\(e\) => e\.detail === 0/);
    const preview = palette.match(/<div class="grid preview-grid"[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(preview).toMatch(/onclick=\{\(e\) => e\.detail === 0/);
  });

  it('removing a colour keeps focus in the grid', () => {
    expect(palette).toContain('refocusCell(');
  });

  it('a cell says which of the two colours it holds', () => {
    expect(t('palette.is_stroke')).toBe('контур');
    expect(t('palette.is_fill')).toBe('заливка');
    expect(palette).toContain("t('palette.is_stroke')");
  });

  it('closing the preview hands focus back to its tile', () => {
    expect(palette).toContain('closePreview(');
  });
});

describe('the plain colour widget', () => {
  it('the fill swatch picks like every other colour way', () => {
    // It wrote fillColor straight, so an eraser stayed an eraser.
    expect(panel).toContain("editor.pickColor(e.currentTarget.value, 'fill', true)");
  });
});
