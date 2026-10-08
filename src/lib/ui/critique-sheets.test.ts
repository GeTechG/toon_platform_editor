import { describe, expect, it } from 'bun:test';
import ru from '../i18n/ru.json';
import { t } from '../i18n';

// Critique 2026-10-08, the sheets around the drawing: what the live run found
// and the source is held to. Read from the source, as the audits' tests are —
// the sheets are components, and what is guarded is what they are made of.
const UI = new URL('./', import.meta.url).pathname;
const read = (name: string) => Bun.file(UI + name).text();

describe('a question whose yes cannot be taken back', () => {
  it('opens on «Отмена»: the sheet takes a mark of it and gives the no-key the focus', async () => {
    const editor = await read('Editor.svelte');
    expect(editor).toContain('autofocus={question.final}');
    expect(editor).toContain("put('ask', message, yes, '', final)");
  });

  it('drafts, saved palettes, the track and a plugin are asked about that way', async () => {
    const editor = await read('Editor.svelte');
    expect(editor).toContain("ask(t('editor.drafts_wipe_confirm'), t('ask.delete'), true)");
    expect(editor).toMatch(/drafts_delete_confirm', \{ count: ids\.length \}\)/);
    expect(editor).toContain("ask(question, t('ask.delete'), true)");
    expect(await read('SettingsSheet.svelte')).toContain("t('settings.wipe_palettes_confirm'), t('ask.delete'), true)");
    expect(await read('AudioPanel.svelte')).toContain("t('audio.remove_confirm'), t('ask.delete'), true)");
    expect(await read('PluginsSheet.svelte')).toContain("t('ask.delete'), true)");
  });

  it('a layer and a frame come back with Z, so their yes keeps the focus', async () => {
    const state = await read('editor-state.svelte.ts');
    expect(state).not.toContain("t('ask.delete'), true");
  });
});

describe('the drafts hub', () => {
  it('«Удалить все» stands last, past «Готово», and says how many it takes', async () => {
    const hub = await read('DraftsHub.svelte');
    expect(hub.indexOf("t('editor.drafts_wipe'")).toBeGreaterThan(hub.indexOf("{t('editor.done')}"));
    expect(t('editor.drafts_wipe', { count: 7 })).toBe('Удалить все (7)');
  });

  it('the head is as tall without its keys as with them: ticking a card moves nothing', async () => {
    const hub = await read('DraftsHub.svelte');
    const head = hub.slice(hub.indexOf('\n  .hub-head {'), hub.indexOf('\n  .hub-head h2 {'));
    expect(head).toContain('min-height: calc(var(--key-h, 2.75rem) + 1.5rem)');
  });

  it('the figure beside the count says what it counts — the whole studio, not the drafts', () => {
    expect(t('editor.storage_used', { size: '240 КБ' })).toBe('· вся студия занимает 240 КБ');
  });

  it('closing gives the focus back to the key it was called from', async () => {
    const editor = await read('Editor.svelte');
    expect(editor).toContain('hubFrom = document.activeElement;');
    expect(editor).toMatch(/const back = hubFrom;[\s\S]{0,300}back\.focus\(\)/);
  });

  it('«Новый мульт» under a finger opens on «Рисовать», not on the size chip', async () => {
    const hub = await read('DraftsHub.svelte');
    expect(hub).toContain("querySelector<HTMLElement>('.draft-open, .reel .draw, .hub-new')");
  });

  it('the picked sheet has one ring, not the focus ring around its own', async () => {
    const hub = await read('DraftsHub.svelte');
    expect(hub).toMatch(/\.draft-open\.picked:focus-visible \.draft-thumb \{\s+outline-color: transparent;/);
  });
});

describe('the sound plate', () => {
  it('closes on Esc from inside and hands the focus back to its key', async () => {
    const plate = await read('AudioPanel.svelte');
    expect(plate).toMatch(/onkeydown=\{\(e\) => \{\s+if \(e\.key === 'Escape' && !docked/);
    expect(plate).toMatch(/function close\(\): void \{\s+anchor\?\.focus\(\);/);
  });

  it('a key near the left edge holds it by its left side, clear of the thickness rail', async () => {
    expect(await read('AudioPanel.svelte')).toContain('key.right - box.width >= 8 ? key.right - box.width : key.left');
  });
});

describe('the export sheet', () => {
  it('forgets «Файл готов» and its picture when the format or an option changes', async () => {
    const sheet = await read('ExportSheet.svelte');
    expect(sheet).toMatch(/void format;\s+void width;\s+void watermark;\s+void transparent;[\s\S]{0,120}forget\(\);\s+stage = '';/);
  });

  it('on a low screen «Скачать» holds to the bottom of what scrolls', async () => {
    const sheet = await read('ExportSheet.svelte');
    expect(sheet).toMatch(/@media \(max-height: 30rem\) \{[^{}]*:global\(\.editor\) \.sheet-body > \.download \{\s+position: sticky;/);
  });
});

describe('a file that does not open', () => {
  it('is found out before the question about the drawing it would replace', async () => {
    const editor = await read('Editor.svelte');
    const open = editor.slice(editor.indexOf('async function openFile('), editor.indexOf('function adoptOpenedDoc('));
    expect(open.indexOf('decodeToon(')).toBeGreaterThan(0);
    expect(open.indexOf("'editor.file_open_confirm'")).toBeGreaterThan(open.indexOf('decodeToon('));
    expect(open.indexOf("'editor.file_open_confirm'")).toBeGreaterThan(open.indexOf("t('editor.file_not_toonop')"));
  });

  it('its message goes with the drawing it was said over', async () => {
    const editor = await read('Editor.svelte');
    expect(editor).toMatch(/void editor\.doc;[\s\S]{0,200}importError = '';/);
  });
});

describe('words', () => {
  it('a plugin is named as one, so «установлен» and «удалён» agree with it', () => {
    expect(t('plugins.installed_report', { name: 'Ровная линия' })).toBe('Плагин «Ровная линия» установлен');
    expect(t('plugins.removed_report', { name: 'Ровная линия' })).toBe('Плагин «Ровная линия» удалён');
  });

  it('the paste question fits one cell as well as many', () => {
    expect(ru.frame.replace_confirm).not.toMatch(/Ячейки|их /);
  });

  it('in «Справка» Q is not two things: the turn row says it is inside the transform', () => {
    expect(ru.key.transform_turn).toStartWith('В трансформации');
    expect(ru.key.transform_turn).toContain('15°');
  });

  it('the local save is called by what it does', () => {
    expect(ru.editor.save).toBe('Сохранить на устройстве');
    expect(ru.editor.save_title).toBe('Сохранить на устройстве сейчас (Ctrl+S)');
  });
});

describe('settings', () => {
  it('the transform lock, the storage request and the preset row each say what they do', async () => {
    const sheet = await read('SettingsSheet.svelte');
    expect(sheet).toContain("t('settings.lock_transform_hint')");
    expect(sheet).toContain("t('settings.ask_persist_hint')");
    expect(sheet).toContain("t('settings.preset_hint')");
    expect(ru.settings.persist_off).toContain('копию');
  });

  it('with nothing that hovers, the switches of a mouse and a keyboard are not shown', async () => {
    const sheet = await read('SettingsSheet.svelte');
    expect(sheet).toContain("matchMedia('(any-hover: none)')");
    for (const key of ['settings.mouse_mode', 'settings.crosshair', 'settings.letter_keys']) {
      const at = sheet.indexOf(`{t('${key}')}`);
      expect(sheet.slice(0, at).lastIndexOf('{#if !fingersOnly}')).toBeGreaterThan(sheet.slice(0, at).lastIndexOf('{/if}'));
    }
  });

  it('«Справка» there is the gestures alone', async () => {
    const editor = await read('Editor.svelte');
    expect(editor).toContain('{#if !fingersOnly}{@render (touchFirst ? keyList : gestureList)()}{/if}');
  });
});

describe('the dropdown', () => {
  it('opens from its button on the arrows, as the list it stands for does', async () => {
    const list = await read('Dropdown.svelte');
    expect(list).toMatch(/e\.key === 'ArrowDown' \|\| e\.key === 'ArrowUp'[\s\S]{0,160}showPopover\(\)/);
  });
});

// A phone lying down under the site's header (a Galaxy S8, 740×360) leaves the
// «Новый мульт» page about 11 rem: the plate is capped at the page and at the
// sheet's proportion its words were taller, so «Рисовать» hung out of its
// bottom edge. The line about the sheet stays; the plate grows sideways.
it('on a page too low for its words the sheet card grows wide, and keeps its line', async () => {
  const hub = await read('DraftsHub.svelte');
  expect(hub).toMatch(/@container reel \(max-height: 13rem\) \{\s*\.reel-plate:not\(\.beside\) \{\s*width: min\(100cqw, 26rem\);\s*aspect-ratio: auto;/);
  expect(hub).not.toMatch(/\.reel-about \{\s*display: none/);
});
