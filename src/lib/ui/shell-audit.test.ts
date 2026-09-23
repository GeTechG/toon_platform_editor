import { describe, expect, it } from 'bun:test';
import { t } from '../i18n';

// Tenth audit, the studio shell. Editor.svelte is asserted as source, like
// editor-keys.test.ts and project-file.test.ts; the store it calls into is
// tested for real in draft/store.test.ts.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

function fn(name: string): string {
  const match = editorUi.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

describe('the draft already on the canvas', () => {
  it('is not reloaded from its older copy on disk', () => {
    // The list is read when the sheet opens; strokes drawn since were lost
    // when the same draft was «opened» over them, and the next autosave
    // wrote the older copy over the newer record.
    expect(fn('openDraft')).toMatch(/entry\.id === draftId[^]*?close\(\)[^]*?return;/);
  });

  it('is marked in the list, so pressing it closing the sheet is expected', () => {
    expect(editorUi).toContain("t('draft.current')");
    expect(t('draft.current')).toBe('сейчас на холсте');
  });
});

describe('replacing the drawing waits for its own save', () => {
  it('saveNow answers whether the drawing is on disk', () => {
    expect(fn('saveNow')).toContain('Promise<boolean>');
  });

  it('a draft or a file opens only once the current drawing is written — after a failure too', () => {
    // saveNow() without byHand returned at once after a failed write, and the
    // drawing was replaced with nothing on disk.
    for (const name of ['openDraft', 'openFile']) {
      expect(fn(name)).toMatch(/if \(!\(await saveNow\(true\)\)\) \{\s*return;/);
    }
  });
});

describe('closing the drafts sheet by opening a draft', () => {
  it('closes the dialog, so focus goes back to the key that opened it', () => {
    // Unmounting an open <dialog> drops focus on <body>.
    expect(fn('openDraft')).toContain('draftsDialog?.close()');
    expect(fn('openDraft')).not.toContain('draftsOpen = false');
  });
});

describe('Shift+Delete on a layer', () => {
  it('asks once — removeActiveLayer asks itself', () => {
    expect(editorUi).not.toContain("t('editor.layer_has_strokes')");
    expect(editorUi).toMatch(/if \(e\.shiftKey\) \{\s*editor\.removeActiveLayer\(\);/);
  });
});

describe('storage the browser refuses', () => {
  it('is not reported as saved, and the tab still guards the drawing', () => {
    // saveDraft answers ok with 0 bytes when there is no IndexedDB at all.
    expect(fn('saveNow')).toMatch(/bytes === 0[^]*?storageBlocked = true[^]*?dirty = true/);
    expect(editorUi).toContain("t('editor.save_unavailable')");
    expect(t('editor.save_unavailable')).toContain('закроешь вкладку');
  });
});

describe('stage notes', () => {
  it('sit in a live region that is always there', () => {
    // Alt+Enter and its «вопросы выключены» note are gone (owner-twelfth-shell).
    expect(editorUi).toMatch(/class="stage-notes"[^>]*role="status"/);
  });
});

describe('copy', () => {
  it('names the formats a dropped file may have instead of hedging', () => {
    expect(t('editor.file_unsupported')).not.toContain('Кажется');
    expect(t('editor.file_unsupported')).toContain('.toonop');
  });

  it('calls the drafts by the name of the sheet they are in', () => {
    expect(t('editor.save_failed_alert')).toContain('«Черновиках»');
    expect(t('editor.drafts_key')).toBe(t('editor.drafts'));
  });
});

describe('a draft row', () => {
  it('ties its copy, download and delete keys to the draft they act on', () => {
    expect(editorUi).toMatch(/<span class="draft-date" id="draft-date-\{entry\.id\}"/);
    expect(editorUi.match(/aria-describedby="draft-date-\{entry\.id\}"/g)?.length).toBe(3);
  });

  it('a copy made or a draft deleted is heard, not only seen', () => {
    // Eleventh audit: the region wraps the empty-list line too (audit11-shell).
    expect(editorUi).toMatch(/<div class="drafts-said" aria-live="polite">[^]*?<p class="sheet-hint">\s*\{t\('draft\.count'/);
  });
});
