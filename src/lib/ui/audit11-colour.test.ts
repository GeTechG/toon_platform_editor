import { describe, expect, it } from 'bun:test';
import { t } from '../i18n';

const read = (name: string) => Bun.file(new URL(name, import.meta.url)).text();
const picker = await read('./ColourPicker.svelte');
const palette = await read('./PaletteBox.svelte');
const panel = await read('./ColorPanel.svelte');

describe('eleventh audit: colour', () => {
  it('the colour window comes back on screen after the screen turns', () => {
    // Opened at 1280 and turned to 390, it stayed at x = 1041: only Esc —
    // which throws the colour away — could reach it again.
    expect(picker).toMatch(/<svelte:window onresize=\{keepInside\}/);
    expect(picker).toMatch(/function keepInside\(/);
  });

  it('the preview grid is one Tab stop with arrows inside', () => {
    // Every colour of a saved palette was its own Tab stop — up to 300.
    const grid = palette.match(/<div class="grid preview-grid"[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(grid).toMatch(/tabindex=\{i === previewStop \? 0 : -1\}/);
    expect(grid).toMatch(/walkGrid\(/);
  });

  it('a long press on a cell takes the fill, as the right button does', () => {
    // A finger has no right button: the fill could only come from the picker.
    const grid = palette.match(/<div class="grid" class:remover[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(grid).toMatch(/oncontextmenu=\{\(e\) => longPress\(e, \(\) => onCell\(/);
    const preview = palette.match(/<div class="grid preview-grid"[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(preview).toMatch(/oncontextmenu=\{\(e\) => longPress\(e, \(\) => onPreviewCell\(/);
    expect(palette).toMatch(/function longPress[\s\S]*?pointerType === 'mouse'/);
  });

  it('the plain widget’s outline gives the eraser way, like every other pick', () => {
    // setBrushColor kept the eraser armed: a colour picked, nothing drawn.
    expect(panel).not.toMatch(/oninput=\{\(e\) => editor\.setBrushColor/);
    expect(panel).not.toMatch(/class="cell"[\s\S]*?onclick=\{\(\) => editor\.setBrushColor/);
    expect(panel).toContain("editor.pickColor(e.currentTarget.value, 'outline', true)");
    expect(panel).toContain("editor.pickColor(color, 'outline', true)");
  });

  it('a channel field names its channel, not only its letter', () => {
    expect(picker).toMatch(/aria-label=\{`\$\{name\}, \$\{t\(`picker\.channel_\$\{key\}`\)\}`\}/);
  });

  it('a pasted colour is not cut to seven characters first', () => {
    // « #12ab34» was cut to « #12ab3» and painted #12ab30 without a word.
    const hex = picker.match(/<label class="hex">[\s\S]*?<\/label>/)?.[0] ?? '';
    expect(hex).not.toContain('maxlength');
  });

  it('a full palette does not count «из 1 цветов»', () => {
    expect(t('palette.full', { limit: 50, skipped: 1 })).not.toMatch(/из 1 цветов/);
    expect(t('palette.full', { limit: 50, skipped: 1 })).toContain('50');
  });
});
