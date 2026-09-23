import { describe, expect, it } from 'bun:test';
import ru from '../i18n/ru.json';

// The manual is a mirror of the key handler. It used to be written once for
// the old default and footnote the Toonio meaning in brackets — and then the
// default grew a feather, so it promised fullscreen on F while F picked the pen.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const box = await Bun.file(new URL('./PaletteBox.svelte', import.meta.url)).text();
const table = editorUi.slice(editorUi.indexOf('const SHORTCUTS'), editorUi.indexOf(']);', editorUi.indexOf('const SHORTCUTS')));

describe('the manual says what each key does in this studio', () => {
  it('names no other preset in brackets', () => {
    for (const line of Object.values(ru.key)) expect(line).not.toContain('Toonio');
  });

  it('F reads as the pen where the pen is on the panel, fullscreen elsewhere', () => {
    expect(table).toMatch(/\['F', hasFeather \? t\('tool\.feather\.label'\) : t\('key\.fullscreen'\)\]/);
  });

  it('M reads as the palette or the merge, as the preset decides', () => {
    expect(table).toMatch(/\['M', quickPalette \? t\('key\.palette'\) : t\('key\.merge'\)\]/);
  });

  it('lists the tool keys the handler holds, only where the tool is', () => {
    expect(table).toContain("has('drag')");
    expect(table).toContain("has('lasso')");
    expect(table).toContain("has('distort')");
    expect(table).toContain('hasMegaEraser');
    expect(table).toContain("t('key.mirror')");
  });
});

describe('owner after the tenth audit: the pipette into the fill from the keys', () => {
  it('Shift+Enter on the pipette key arms it for the fill, as the right button does', () => {
    const at = box.indexOf("onclick={() => editor.selectTool('pipette')}");
    const key = box.slice(at, box.indexOf('</button>', at));
    expect(key).toMatch(/e\.key === 'Enter' && e\.shiftKey[^]*editor\.selectTool\('pipette', 'fill'\)/);
  });

  it('says so on the key and in the manual', () => {
    expect(ru.palette.pipette_title).toContain('Shift+Enter');
    expect(ru.palette.pipette).toContain('Shift+Enter');
    expect(table).toContain("['Shift + Enter', t('key.pick_fill')]");
    expect(ru.key.pick_fill).toContain('заливк');
  });
});
