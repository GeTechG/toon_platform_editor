import { describe, expect, it } from 'bun:test';
import { Glob } from 'bun';
import ru from '../i18n/ru.json';
import { dateLocale, i18n } from '../i18n-core';

// Fourteenth audit, the small screens and the shared system. Measured live at
// 360×740, 390×844, 740×360, 820×1180 and 1366×1024 (a coarse pointer), at
// 100 % and 200 % text; asserted here as source, like audit13-system.
const UI = new URL('./', import.meta.url).pathname;
const editorUi = await Bun.file(UI + 'Editor.svelte').text();
const controls = await Bun.file(UI + 'controls.css').text();
const rule = (selector: string, from = editorUi) => {
  const at = from.indexOf(`${selector} {`);
  return at < 0 ? '' : from.slice(at, from.indexOf('}', at));
};

describe('a field under a finger is 16 px or more', () => {
  // Safari on an iPhone zooms the page onto a focused field under 16 px and
  // leaves it zoomed. Three components had fixed their own; the transform
  // fields (13 px), the picker's hex (12 px), the catalogue address in the
  // settings (15.2 px) and the layout name had not.
  it('controls.css lifts every text-like field on a coarse pointer', () => {
    const coarse = controls.match(/@media \(pointer: coarse\) \{[^]*?\n\}/)?.[0] ?? '';
    expect(coarse).toMatch(/input:not\([^)]*'range'[^)]*\)/);
    expect(coarse).toContain('select');
    expect(coarse).toContain('textarea');
    expect(coarse).toMatch(/font-size:\s*max\(16px, 1em\) !important/);
  });
});

describe('the tab window does not outlive the small screen', () => {
  // A tablet turned (or text made smaller) goes to the full layout with the
  // tab still «open»: turned back, the window came up by itself.
  it('leaving the compact step closes it', () => {
    expect(editorUi).toMatch(/\$effect\(\(\) => \{\s*if \(!compact\) moreOpen = false;\s*\}\);/);
  });

  it('a track dropped opens the sound plate, on a phone as on a desk: its key is in the transport row', () => {
    expect(editorUi).toMatch(/isAudioFile\(file\)\) \{[^}]*audioOpen = true;/);
  });
});

describe('a bottom sheet keeps off the cutout lying down', () => {
  // Under 641 px wide (a small phone lying down, or any phone at a browser
  // text size of 200 %) a sheet runs edge to edge — its close key under the
  // notch. The centred card is clear of it and pads nothing.
  it('pads its sides by the safe area, and the card resets it', () => {
    expect(rule('.editor :global(.sheet)')).toMatch(/padding-inline:\s*env\(safe-area-inset-left\) env\(safe-area-inset-right\)/);
    const card = editorUi.slice(editorUi.indexOf('@media (min-width: 40.0625rem)'));
    expect(rule('.editor :global(.sheet)', card)).toMatch(/padding-inline:\s*0/);
  });
});

describe('a copy is told without the flash', () => {
  // C and V said so by a 50 ms flash of the stage alone: a reader heard
  // nothing, and under reduced motion — where the flash is skipped — nobody
  // saw anything either.
  it('the words are in the dictionary', () => {
    expect(ru.editor.copied).toBe('Скопировано');
    expect(ru.editor.pasted).toBe('Вставлено');
  });

  it('the stage says it in its status region, shown where the flash is not', () => {
    expect(editorUi).toMatch(/t\(copied \? 'editor\.copied' : 'editor\.pasted'\)/);
    const notes = editorUi.match(/<div class="stage-notes" role="status">[^]*?<\/div>/)?.[0] ?? '';
    expect(notes).toMatch(/\{#if clipNote\}\s*<p class="stage-note" class:sr-only=\{!clipShown\}>\{clipNote\}<\/p>/);
  });
});

describe('dates speak the interface’s language', () => {
  // Three spellings of «Russian» ('ru', 'ru-RU' and the settings list with
  // seconds): a translation would have kept Russian dates.
  it('the locale is the catalogue’s', () => {
    expect(dateLocale()).toBe(i18n.language);
  });

  it('no date is formatted with a hard-coded locale', async () => {
    const found: string[] = [];
    for await (const file of new Glob('**/*.svelte').scan(UI + '..')) {
      const text = await Bun.file(UI + '../' + file).text();
      if (/toLocale\w*String\('ru/.test(text)) found.push(file);
    }
    expect(found).toEqual([]);
  });
});

describe('lying down at 200 % text the dock is one line again', () => {

});
