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

describe('the open tab keeps its word whole', () => {
  // 360×740: the open tab was bold, and «Таймлайн» in bold is 4 px wider than
  // its tab. The words are measured in the regular weight — a change of weight
  // resizes no box, so no observer fired — and «Таймлайн» lost its «н».
  // Reserving the bold width instead sent every 360 px phone to bare icons
  // (all or none, the owner's call), so the weight moved to the icon's line.
  it('the word keeps its weight; the open tab draws its icon heavier', () => {
    expect(rule('.tab.open')).not.toMatch(/font-weight/);
    expect(rule('.tab.open :global(svg)')).toMatch(/stroke-width:\s*2\.75/);
    expect(editorUi).not.toContain('.tab-label::after');
  });
});

describe('the frame rate fits the timeline tab', () => {
  // 390×844 at 200 %: a 6 rem slider and a 3.2 rem box are 381 px in a 270 px
  // window — the box stood past the screen's edge.
  it('shares a line where it fits, and on a line of its own its slider gives way', () => {
    const fps = rule('.tab-window > .fps-inline');
    expect(fps).toMatch(/flex:\s*0 1 auto/);
    expect(fps).toMatch(/max-width:\s*100%/);
    expect(fps).toMatch(/min-width:\s*0/);
    const range = rule(".tab-window .fps-inline input[type='range']");
    expect(range).toMatch(/flex:\s*1 1 auto/);
    expect(range).toMatch(/min-width:\s*0/);
  });
});

describe('a tab points only at a window that is there', () => {
  it('aria-controls on the open tab alone', () => {
    expect(editorUi).toContain("aria-controls={openTab === tab.id ? 'tab-window' : undefined}");
  });
});

describe('the tab window does not outlive the small screen', () => {
  // A tablet turned (or text made smaller) goes to the full layout with the
  // tab still «open»: turned back, the window came up by itself.
  it('leaving the compact step closes it', () => {
    expect(editorUi).toMatch(/\$effect\(\(\) => \{\s*if \(!compact\) openTab = null;\s*\}\);/);
  });

  it('a track dropped on a small screen opens the «Звук» tab, not the desktop plate', () => {
    expect(editorUi).toMatch(/isAudioFile\(file\)\) \{[^}]*compact && cut\?\.tabs\.some\(\(tab\) => tab\.id === 'sound'\)[^}]*openTab = 'sound'/);
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
  // 740×360: the icons grew with the text (owner, thirteenth audit), and a
  // bare tab became 59 px — five of them 312, with the 281 px transport and
  // the 24 px gap 13 px past the dock. The tabs went to a second line, the
  // dock took 131 px and the sheet kept 229 of the 360.
  it('a tab’s sides are a hair, not a quarter rem: its width is the tap floor or the icon', () => {
    expect(rule('.tab')).toMatch(/padding:\s*0\.15rem 0\.1rem;/);
  });

  it('the gap between the transport and the tabs is half a rem, so a 150-frame count still fits', () => {
    expect(rule('\n  .dock')).toMatch(/gap:\s*0\.35rem 0\.5rem;/);
  });
});

describe('the mini transport keeps one line with a long mult', () => {
  // 320×640 at 200 %: «150 / 150», two 44 px steps and a 3.4 rem play key
  // (109 px) are 351 px on a 304 px dock — the count went to a line of its
  // own and the dock took 183 px. Any mult past nine frames did the same.
  it('the play key there is wider than a step, but not by 3.4 rem of text', () => {
    expect(rule('.dock .mini-transport :global(.key.play)')).toMatch(/min-width:\s*min\(3\.4rem, calc\(var\(--tap\) \* 1\.25\)\)/);
    // Its width was the icon and the key's 0.7 rem sides, not the floor.
    expect(rule('.dock .mini-transport :global(.key.play)')).toMatch(/padding-inline:\s*0;/);
  });
});

describe('lying down the column keeps off the home indicator', () => {
  // A phone lying down: the column runs the whole height beside the dock, and
  // the dock alone padded by the bottom inset — «Отправить мульт» at the
  // column's foot (8 px of padding) sat under the 21 px home indicator.
  it('the column pads its foot by the safe area', () => {
    expect(rule('.studio.compact:not(.tall) .left')).toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom\)/);
  });
});
