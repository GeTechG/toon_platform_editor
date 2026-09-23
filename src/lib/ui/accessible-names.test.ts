import { describe, expect, it } from 'bun:test';

// Names and announcements a screen reader was not getting. Each of these is a
// line of markup that reads fine to the eye and says nothing out loud.
const read = (file: string) => Bun.file(new URL(`./${file}`, import.meta.url)).text();
const colorPanel = await read('ColorPanel.svelte');
const exportSheet = await read('ExportSheet.svelte');
const settingsSheet = await read('SettingsSheet.svelte');
const palette = await read('PaletteBox.svelte');
const brush = await read('BrushPanel.svelte');
const editorUi = await read('Editor.svelte');

describe('a colour input says which colour it is', () => {
  it('the label around it carries only a title, which names nothing (WCAG 4.1.2)', () => {
    const inputs = [...colorPanel.matchAll(/<input\s+type="color"[^]*?\/>/g)].map((m) => m[0]);
    expect(inputs.length).toBe(2);
    expect(inputs[0]).toContain("aria-label={t('color.stroke_title')}");
    expect(inputs[1]).toContain("aria-label={t('color.fill_title')}");
  });
});

describe('a progress bar has a name, and the count is not read every tick', () => {
  it('the export announces its stage once per stage, not every percent', () => {
    // The status region stays mounted: one inserted together with its text is
    // often not announced at all.
    expect(exportSheet).not.toMatch(/role="status">\{stage\} \{progress\}%/);
    expect(exportSheet).toMatch(/<p class="sr-only" role="status">\{stage\}<\/p>/);
    expect(exportSheet).toMatch(/<progress[^>]*aria-label=/);
  });

  it('the drafts download names its bar', () => {
    expect(settingsSheet).toMatch(/<progress[^>]*aria-label=/);
  });
});

describe('a label goes on something that can carry one', () => {
  it('the palette and the brush box are named groups, not named divs', () => {
    expect(palette).toMatch(/<div class="box palette" role="group" aria-label=/);
    expect(brush).toMatch(/<div class="box brush-box" role="group" aria-label=/);
  });

  it('the updating window is named by its own sentence', () => {
    expect(editorUi).toMatch(/<dialog class="updating"[^>]*aria-labelledby="editor-updating"/);
    expect(editorUi).toContain('id="editor-updating"');
  });
});

describe('the save status is heard when it changes', () => {
  it('a failed save is an alert, and the region is there before its text', () => {
    const status = editorUi.match(/<span\s+class="saved save-status[^]*?<\/span>/)?.[0] ?? '';
    expect(status).not.toBe('');
    expect(editorUi).toContain("role={saveFailed ? 'alert' : 'status'}");
  });
});

describe('a sheet with nothing to focus can still be scrolled from the keys', () => {
  it('the manual body is a Tab stop (WCAG 2.1.1)', () => {
    // The shortcut list scrolls, and nothing inside it takes focus — so the
    // arrow keys had nowhere to scroll from.
    const manual = editorUi.slice(editorUi.indexOf("<h2>{t('editor.manual')}</h2>"));
    expect(manual.match(/<div class="sheet-body"[^>]*>/)![0]).toContain('tabindex="0"');
    // The sheet clips what stands outside it: a ring drawn out there showed
    // as two red rules, top and bottom. Drawn inside, it is a whole ring.
    expect(editorUi).toMatch(/\.editor :global\(\.sheet-body:focus-visible\) \{[^}]*outline-offset: -3px/);
  });
});
