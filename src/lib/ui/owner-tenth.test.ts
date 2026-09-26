import { describe, expect, it } from 'bun:test';

// Owner's calls after the tenth audit that live in the studio shell.
// Editor.svelte is asserted as source, like shell-audit.test.ts; the store it
// calls into is tested for real in draft/store.test.ts.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

function fn(name: string): string {
  const match = editorUi.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

describe('deleting the draft that is on the canvas', () => {
  it('leaves the drawing on screen unsaved: Save lights up and closing the tab warns', () => {
    expect(fn('removeDraft')).toMatch(/draftId === entry\.id\)? \{[^}]*forgetStoredDraft\(\)/);
    expect(fn('removeAllDrafts')).toContain('forgetStoredDraft()');
    const forget = fn('forgetStoredDraft');
    expect(forget).toContain('draftId = newDraftId()');
    expect(forget).toContain('dirty = true');
    expect(forget).toContain('editor.lastSavedAt = null');
  });

  it('the save that makes the new record carries the track on screen', () => {
    expect(fn('saveNow')).toMatch(/saveDraft\(draftId, doc, editor\.sessionState\(\), track\)/);
  });
});

describe('a drafts bundle dropped on the window', () => {
  it('loads like «Загрузить черновики…» instead of «формат не поддерживается»', () => {
    const drop = fn('onDrop');
    expect(drop).toMatch(/\\\.\(toonops\|toonio\)\$\/i\.test\(file\.name\)[^]*?openDraftsFile\(file\)/);
    expect(drop.indexOf('openDraftsFile')).toBeLessThan(drop.indexOf('file_unsupported'));
    const load = fn('openDraftsFile');
    expect(load).toContain("t('settings.drafts_confirm'");
    expect(load).toContain('importDrafts(await file.text())');
    expect(load).toContain('openDrafts()');
    expect(load).toContain("t('settings.drafts_load_failed')");
  });
});

describe('a plugin that will not go in', () => {
  it('is told in one human line, the author\'s reason going to the console and the log', async () => {
    const sheet = await Bun.file(new URL('./PluginsSheet.svelte', import.meta.url)).text();
    const reports = [...sheet.matchAll(/t\('plugins\.failed_report', \{ name: [^,]+, reason: ([^}]+) \}\)/g)].map((m) => m[1].trim());
    // Three: a download the plugins window does itself, an install, a file.
    expect(reports).toEqual(['forPerson(failed)', 'forPerson(failed)', 'forPerson(failed)']);
    expect(sheet.match(/console\.error\([^)]*failed\)/g)).toHaveLength(2);
  });
});

describe('the manual names redo under Ctrl+Shift+Z', () => {
  it('lists it next to Y', () => {
    expect(editorUi).toContain("['Y, Ctrl+Shift+Z', t('key.redo')]");
  });
});
