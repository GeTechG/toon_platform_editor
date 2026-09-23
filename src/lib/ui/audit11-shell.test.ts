import { afterEach, describe, expect, it, mock } from 'bun:test';
import { t } from '../i18n';
import { repeats } from './key-owner';
import { duplicateDraft, listDrafts, saveDraft } from '../draft/store';
import { FakeReq, fakeIndexedDB, setIndexedDB } from '../test-support/fake-idb';

// Eleventh audit, the studio shell. Editor.svelte is asserted as source, like
// shell-audit.test.ts; what can run for real (the key rule, the store) does.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

function fn(name: string): string {
  const match = editorUi.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

describe('a held key', () => {
  it('repeats only what is meant to run on: steps, size, zoom, undo, new frames', () => {
    for (const key of ['ArrowLeft', 'ArrowDown', '+', '-', 'z', 'Z', 'y', 'a', 'A', 'F7', 'q', 'w', 'Delete']) {
      expect(repeats(key)).toBe(true);
    }
  });

  it('does not flip a toggle over and over: Space, K, X, M, F, H', () => {
    // Held for half a second, K flipped the onion skin a dozen times and
    // stopped wherever the auto-repeat did; Space started and stopped the
    // preview, and a held Space on a transform applied it and then played.
    for (const key of [' ', 'k', 'K', 'x', 'm', 'f', 'h', 'H', 'Enter', 'c', 'v']) {
      expect(repeats(key)).toBe(false);
    }
  });

  it('is dropped by the handler once the editor owns it', () => {
    const handler = fn('onKeydown');
    expect(handler).toMatch(/if \(e\.repeat && !repeats\(key\)\) \{\s*e\.preventDefault\(\);\s*return;/);
    // Before the transform branch, where Space and H live too.
    expect(handler.indexOf('repeats(key)')).toBeLessThan(handler.indexOf('if (editor.transform)'));
  });

  it('with Ctrl or Alt does its thing once: one save, one log file', () => {
    // A held Alt+L downloaded a log file per auto-repeat.
    const handler = fn('onKeydown');
    expect(handler).toMatch(/if \(!e\.repeat\) \{\s*saveNow\(true\);/);
    expect(handler).toMatch(/if \(!e\.repeat\) \{\s*downloadErrorLog\(\);/);
  });
});

describe('Alt+E and Alt+S under an open sheet', () => {
  it('open nothing on top of it', () => {
    // With the settings open, Alt+S stacked the export over them and Alt+E
    // the mega-eraser warning over both — three modals deep.
    const handler = fn('onKeydown');
    expect(handler).toMatch(/const modalOpen = document\.querySelector\('dialog:modal'\) !== null;/);
    expect(handler).toMatch(/if \(!e\.repeat && !modalOpen\) \{\s*editor\.selectTool\('mega-eraser'\);/);
    expect(handler).toMatch(/if \(e\.repeat \|\| modalOpen\) \{\s*return;\s*\}\s*\/\/ Reference Alt\+S/);
  });
});

describe('a drawing replaced by another', () => {
  it('does not keep the old one’s «сохранено локально»', () => {
    // An opened file read «сохранено локально 22:38» before a byte of it was
    // written — the time and size were the previous drawing’s.
    expect(fn('adoptOpenedDoc')).toContain('editor.lastSavedAt = null;');
    expect(fn('openDraft')).toMatch(/draftId = entry\.id;\s*editor\.lastSavedAt = null;/);
  });
});

describe('the drafts sheet', () => {
  it('says the list is empty in the same live region that counted it', () => {
    // Deleting the last draft swapped the counting region for a plain
    // paragraph, so the one deletion that empties the list was not heard.
    expect(editorUi).toMatch(
      /<div class="drafts-said" aria-live="polite">\s*\{#if drafts\.length === 0\}\s*<p class="empty">\{t\('editor\.drafts_empty'\)\}<\/p>\s*\{:else\}\s*<p class="sheet-hint">/,
    );
  });

  it('a copy that did not fit says so instead of doing nothing', () => {
    expect(fn('copyDraft')).toMatch(/if \(!copy && drafts\.some\(\(d\) => d\.id === entry\.id\)\) \{\s*alert\(t\('editor\.draft_copy_failed'\)\);/);
    expect(t('editor.draft_copy_failed')).toContain('места');
  });
});

describe('duplicating a draft into full storage', () => {
  afterEach(() => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  it('answers null, not the id of a copy that was never written', async () => {
    const inner = fakeIndexedDB() as { open(): FakeReq };
    let full = false;
    setIndexedDB({
      open() {
        const req = inner.open();
        const db = req.result as { transaction(): { onerror: (() => void) | null; objectStore(n: string): { put: unknown } } };
        const open = db.transaction.bind(db);
        db.transaction = () => {
          const tx = open();
          if (full) {
            const store = tx.objectStore.bind(tx);
            tx.objectStore = (n: string) => {
              const s = store(n);
              s.put = () => {
                queueMicrotask(() => tx.onerror?.());
                return new FakeReq();
              };
              return s;
            };
          }
          return tx;
        };
        return req;
      },
    });
    await saveDraft('a', { schema_version: 1 });
    full = true;
    const warn = console.warn;
    console.warn = mock(() => {});
    try {
      expect(await duplicateDraft('a')).toBeNull();
    } finally {
      console.warn = warn;
    }
    expect(await listDrafts()).toHaveLength(1);
  });
});

describe('the update lock', () => {
  it('comes back if the browser lets a second Esc close it', () => {
    // Chrome makes `cancel` uncancellable on a repeated Esc without a click.
    expect(editorUi).toMatch(/class="updating"[^]*?onclose=\{\(\) => editor\.updating && updatingEl\?\.showModal\(\)\}/);
  });
});

describe('copy', () => {
  it('a refused drop names the drafts file it would have taken too', () => {
    expect(t('editor.file_unsupported')).toContain('.toonops');
  });
});
