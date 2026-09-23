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
    // pressesCell takes a detail-0 click from any pointer (audit12-colour).
    expect(grid).toMatch(/onclick=\{\(e\) => pressesCell\('click', pointerKind, e\.detail\)/);
    const preview = palette.match(/<div class="grid preview-grid"[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(preview).toMatch(/onclick=\{\(e\) => pressesCell\('click', pointerKind, e\.detail\)/);
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

describe('tenth audit: the colour window and the palette keep their place', () => {
  it('the focused field drives itself, not the bar the mouse touched last', () => {
    // Shift+Tab from the hue strip to the field, ArrowLeft: the hue moved while
    // the field announced an unchanged saturation.
    expect(picker).not.toContain('lastTarget');
    expect(picker).toMatch(/onSurfaceKey[\s\S]*?target: 'surface'/);
  });

  it('a channel field left empty or out of range shows the channel again', () => {
    const fields = picker.match(/type="number"[\s\S]*?\/>/)?.[0] ?? '';
    expect(fields).toMatch(/onchange=/);
  });

  it('a click on the window’s own padding or past the wheel’s rim keeps it open', () => {
    // The dialog is both the window and its backdrop: any click on its bare
    // padding, or on the clipped corners of the wheel, closed the picker.
    expect(picker).not.toContain('onclick={(e) => e.target === box && requestClose()}');
    expect(picker).toMatch(/function outside\(/);
  });

  it('the preview strip grows with the text', () => {
    expect(picker).not.toMatch(/\.preview \{[^}]*\sheight: 34px/);
  });

  it('focus survives the keys that vanish under it', () => {
    // Erase, load, merge and delete each unmount the key that was pressed.
    expect(palette).toMatch(/function erasePalette[\s\S]*?focusFoot\(/);
    expect(palette).toMatch(/function usePalette[\s\S]*?focusFoot\(/);
    expect(palette).toMatch(/function mergePalette[\s\S]*?focusFoot\(/);
    expect(palette).toMatch(/function deletePalette[\s\S]*?focusFoot\(/);
    expect(palette).toMatch(/async function refocusCell[\s\S]*?focusFoot\(/);
  });

  it('a name of spaces is no name', () => {
    expect(palette).toMatch(/save_prompt[^\n]*\)\?\.trim\(\)/);
  });

  it('the remover shows its cross under the keyboard too', () => {
    expect(palette).toContain('.grid.remover .cell:focus-visible :global(svg)');
  });

  it('the plain strip is one Tab stop with arrows inside', () => {
    const grid = panel.match(/<div class="grid"[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(grid).toMatch(/tabindex=\{i === stop \? 0 : -1\}/);
    expect(panel).toContain('gridStep(');
  });

  it('the merge report names what it counts', () => {
    expect(t('palette.added', { added: 3 })).toContain('цвет');
    expect(t('palette.partial_confirm', { skipped: 3, limit: 50 })).toMatch(/цвет/);
  });
});
