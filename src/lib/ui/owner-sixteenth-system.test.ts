import { describe, expect, it } from 'bun:test';
import { formatPercent, i18n } from '../i18n-core';

// The owner's answers after the sixteenth audit, the small screens and the
// shared system: the thickness rail keeps a finger's width whatever the text
// size, and a percent is written by the interface's locale, not by hand.
const UI = new URL('./', import.meta.url).pathname;
const read = (file: string) => Bun.file(UI + file).text();
const editorUi = await read('Editor.svelte');
const canvas = await read('CanvasView.svelte');
const rule = (selector: string, from: string) => {
  const at = from.indexOf(`${selector} {`);
  return at < 0 ? '' : from.slice(at, from.indexOf('}', at));
};

describe('the thickness rail on a phone', () => {
  // 360×740 at 200 % text: an 88 px rail 40 px in from the column left the
  // sheet 80 px of a 240 px stage. The rail is a finger's control, not text.
  it('is a finger wide whatever the text size, and so are its knob and ends', () => {
    const rail = rule('.size-rail', canvas);
    expect(rail).toMatch(/width:\s*var\(--tap, 44px\)/);
    expect(rule('.rail-knob', canvas)).toMatch(/width:\s*20px;\s*height:\s*20px/);
    expect(rule('.rail-track', canvas)).toMatch(/top:\s*14px;\s*bottom:\s*14px/);
  });

  it('stands half a rem off the column in the compact view: there is no fold tab to clear', () => {
    expect(rule('.studio.compact .stage :global(.size-rail)', editorUi)).toMatch(/left:\s*0\.5rem/);
  });
});

describe('a percent is the locale’s', () => {
  it('is written by Intl: a space before the sign in Russian, none in English', async () => {
    expect(formatPercent(1)).toBe('100 %');
    expect(formatPercent(0.054)).toBe('5 %');
    await i18n.changeLanguage('en');
    try {
      expect(formatPercent(1)).toBe('100%');
    } finally {
      await i18n.changeLanguage('ru');
    }
  });

  it('the zoom, the transform, the picker and the export progress use it, not `%` by hand', async () => {
    const files = await Promise.all(['ScaleMenu.svelte', 'TransformMenu.svelte', 'ColourPicker.svelte', 'ExportSheet.svelte'].map(read));
    for (const text of files) {
      expect(text).toContain('formatPercent(');
      expect(text).not.toMatch(/\}%/);
    }
  });

  it('the words around a percent do not add a sign of their own', async () => {
    const ru = (await import('../i18n/ru.json')).default;
    expect(ru.scale.reset).toBe('Вернуть 100 %');
    expect(ru.scale.value).toBe('Масштаб {{percent}}. Вернуть 100 %');
    expect(ru.picker.field_hsv).toBe('{{color}}: насыщенность {{s}}, яркость {{v}}');
    expect(ru.picker.field_wheel).toBe('{{color}}: оттенок {{h}}°, насыщенность {{s}}');
  });
});
