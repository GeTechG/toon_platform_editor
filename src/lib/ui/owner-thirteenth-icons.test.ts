import { describe, expect, it } from 'bun:test';
import { iconLength } from './icon-size';

// Owner, after the thirteenth audit: the icons grow with the text size. At
// 200 % text a 20 px glyph sat in an 88 px key. The `size` prop keeps its
// meaning — pixels at 100 % text — so no caller changes, and `toon-editor/icon`
// keeps its API for apps/web. The length runs for real, the markup is source.
const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const icon = await read('./Icon.svelte');
const layerRows = await read('./LayerRows.svelte');
const paletteBox = await read('./PaletteBox.svelte');
const pluginsSheet = await read('./PluginsSheet.svelte');
const editorUi = await read('./Editor.svelte');

/** The declarations of the first `selector {` block in a component's style. */
function rule(source: string, selector: string): string {
  const style = source.slice(source.indexOf('<style'));
  const at = style.indexOf(`\n  ${selector} {`);
  if (at < 0) throw new Error(`missing ${selector}`);
  return style.slice(at, style.indexOf('\n  }', at));
}

describe('the size is pixels at 100 % text, drawn in rem', () => {
  it('20 is 1.25rem: the same 20 px against a 16 px root', () => {
    expect(iconLength(20)).toBe('1.25rem');
    expect(iconLength(16)).toBe('1rem');
    expect(iconLength(14)).toBe('0.875rem');
    expect(iconLength(26)).toBe('1.625rem');
  });

  it('rem, not em: the studio mount sets its own 17 px, and an em glyph would drift from the keys in rem', () => {
    expect(iconLength(12)).toMatch(/rem$/);
  });

  it('the svg takes its width and height from that length, not from bare pixels', () => {
    expect(icon).toContain('iconLength(size)');
    expect(icon).not.toMatch(/width=\{size\}/);
    expect(icon).not.toMatch(/height=\{size\}/);
  });

  it('as presentation attributes, so a stylesheet can still size a glyph to its box', () => {
    // The plugin face stretches its svg to 100 %; an inline style would win over that.
    expect(icon).not.toMatch(/style[:=]/);
  });

  it('the API is unchanged: `size` is still an optional number, 20 by default', () => {
    expect(icon).toContain('let { name, size = 20 }: { name: IconName | string; size?: number } = $props();');
  });
});

describe('the keys that hold a glyph grow with it', () => {
  it('the layer row: eye, handle, bin and the add key are in rem', () => {
    for (const selector of ['.eye', '.handle', '.kill', '.add-layer', '.head']) {
      const body = rule(layerRows, selector);
      expect(body).not.toMatch(/(width|height): \d+px/);
    }
  });

  it('the phone layer row keeps its 24 px floor in rem too', () => {
    const phone = layerRows.slice(layerRows.indexOf(':global(:where(.studio.phone)) '));
    expect(phone.slice(0, phone.indexOf('.tag {'))).not.toMatch(/(width|height): 24px/);
  });

  it('the colour blocks: add and swap are in rem', () => {
    expect(rule(paletteBox, '.add')).not.toMatch(/(width|height): \d+px/);
    expect(rule(paletteBox, '.swap')).not.toMatch(/(width|height): \d+px/);
  });

  it('the plugin face is in rem', () => {
    expect(rule(pluginsSheet, '.face')).not.toMatch(/(width|height): \d+px/);
  });

  it('the bottom panel’s clip margin grows with the lying tab, as a bare rem', () => {
    // Chromium drops `overflow-clip-margin: calc(…)` whole: the margin fell to
    // 0 and the lying tab vanished under the stage at every text size.
    expect(editorUi).toMatch(/overflow-clip-margin: [\d.]+rem;/);
    expect(editorUi).not.toMatch(/overflow-clip-margin: calc/);
  });

  it('the fold tabs hold their 14 px arrow in rem', () => {
    expect(rule(editorUi, '.fold')).not.toMatch(/width: 15px/);
    expect(rule(editorUi, '.fold.lying')).not.toMatch(/height: 15px/);
  });
});
