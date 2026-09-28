import { afterEach, describe, expect, it, mock } from 'bun:test';
import { latinKey, typesText, type KeyTarget } from './key-owner';
import { createDocument } from '../model/operations';
import { listDrafts, saveDraft } from '../draft/store';
import { fakeIndexedDB, setIndexedDB } from '../test-support/fake-idb';

// Thirteenth audit, the studio shell. Editor.svelte is asserted as source, like
// audit12-shell.test.ts; what can run for real (the key rules, the store) does.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

function fn(name: string): string {
  const match = editorUi.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

const doc = (fps: number) => ({ ...createDocument(), frame_rate: fps });

async function quietly<T>(run: () => Promise<T>): Promise<T> {
  const warn = console.warn;
  console.warn = mock(() => {});
  try {
    return await run();
  } finally {
    console.warn = warn;
  }
}

describe('Caps Lock', () => {
  it('does not change what a letter key means: the case is Shift’s', () => {
    // With Caps Lock on, Ctrl+Z arrived as «Z» and redid instead of undoing,
    // A added a layer instead of a frame, H flipped the frame upside down.
    expect(latinKey({ key: 'Z', code: 'KeyZ', shiftKey: false })).toBe('z');
    expect(latinKey({ key: 'a', code: 'KeyA', shiftKey: true })).toBe('A');
    expect(latinKey({ key: 'H', code: 'KeyH', shiftKey: false })).toBe('h');
    // A Russian layout under Caps Lock: «Я» is Z, and still undo.
    expect(latinKey({ key: 'Я', code: 'KeyZ', shiftKey: false })).toBe('z');
    expect(latinKey({ key: 'я', code: 'KeyZ', shiftKey: true })).toBe('Z');
  });

  it('leaves everything that is not a letter as it was typed', () => {
    expect(latinKey({ key: '+', code: 'Equal', shiftKey: true })).toBe('+');
    expect(latinKey({ key: '~', code: 'Backquote', shiftKey: true })).toBe('~');
    expect(latinKey({ key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: false })).toBe('ArrowLeft');
    expect(latinKey({ key: 'F7', code: 'F7', shiftKey: false })).toBe('F7');
  });

  it('the editor hands the whole event over, Shift included', () => {
    expect(fn('onKeydown')).toContain('const key = latinKey(e);');
  });
});

describe('Alt chords in a text field', () => {
  const el = (tagName: string, attrs: Record<string, string> = {}): KeyTarget => ({
    tagName,
    isContentEditable: false,
    getAttribute: (name) => attrs[name] ?? null,
    matches: () => false,
  });

  it('a field is where text is typed; a key, a slider or a box is not', () => {
    expect(typesText(el('INPUT', { type: 'text' }))).toBe(true);
    expect(typesText(el('INPUT'))).toBe(true);
    expect(typesText(el('TEXTAREA'))).toBe(true);
    expect(typesText(el('INPUT', { type: 'number' }))).toBe(true);
    expect(typesText(el('INPUT', { type: 'range' }))).toBe(false);
    expect(typesText(el('INPUT', { type: 'checkbox' }))).toBe(false);
    expect(typesText(el('BUTTON'))).toBe(false);
    expect(typesText(null)).toBe(false);
  });

  it('stay the field’s: Option+E is é on a Mac, AltGr+E/S/L are ę ś ł in Polish', () => {
    // Alt+E, Alt+S and Alt+L were taken before anyone asked who the key
    // belonged to: a track's author could not be typed with an accent, and
    // the mega-eraser came up instead.
    const keys = fn('onKeydown');
    const guard = keys.search(/if \(e\.altKey && typesText\(/);
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(keys.indexOf("e.altKey && (key === 'e'"));
    // Ctrl+S from a field is still the studio's save: only Alt is let go.
    expect(keys.slice(guard, keys.indexOf('\n', guard))).not.toMatch(/ctrlKey|metaKey/);
  });
});

describe('the drafts connection', () => {
  afterEach(() => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  it('is opened again when the browser closed it under the page', async () => {
    // Safari drops the connection of a tab left in the background («Connection
    // to Indexed Database server lost»); clearing site data closes it too. The
    // one kept for the page was used for ever after: every autosave failed and
    // said «не сохранился» until a reload.
    const inner = fakeIndexedDB() as { open(): { result: { transaction(): unknown } } };
    let opened = 0;
    const dead = { on: false };
    setIndexedDB({
      open() {
        const req = inner.open();
        opened++;
        const db = req.result;
        const open = db.transaction.bind(db);
        const first = opened === 1;
        db.transaction = () => {
          if (first && dead.on) {
            throw new DOMException('The database connection is closing.', 'InvalidStateError');
          }
          return open();
        };
        return req;
      },
    });
    expect((await saveDraft('a', doc(1))).ok).toBe(true);
    dead.on = true;
    const second = await quietly(() => saveDraft('a', doc(2)));
    expect(second.ok).toBe(true);
    const list = await listDrafts();
    expect(list.map((d) => (d.doc as { frame_rate: number }).frame_rate)).toEqual([2]);
  });

  it('a list asked for right after a save sees it', async () => {
    // The list read around the queue: the sheet opened after a save (the
    // card's copy and download) got the record from before it.
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(1));
    void saveDraft('a', doc(7));
    const list = await listDrafts();
    expect((list[0].doc as { frame_rate: number }).frame_rate).toBe(7);
  });
});

describe('what is on the screen is what leaves', () => {
  it('a publish applies a live transform first — the move on screen went unpublished', () => {
    const at = editorUi.indexOf("{:else if id === 'publish'}");
    const block = editorUi.slice(at, editorUi.indexOf("{:else if id === 'merge'}", at));
    expect(block).toMatch(/editor\.leaveTransform\(\)[^]*onPublish\?\.\(/);
  });

  it('so does an export', () => {
    // The sheet stands outside the panels since owner-fourteenth-shell.
    const at = editorUi.search(/\n\s*<ExportSheet\b/);
    const block = editorUi.slice(at, editorUi.indexOf('/>', at));
    expect(block).toMatch(/onOpen=\{\(\) => \{[^}]*editor\.leaveTransform\(\)[^}]*saveNow\(\)/);
  });

  it('and leaving the studio keeps the move in the draft', () => {
    const destroy = editorUi.match(/onDestroy\(\(\) => \{[^]*?\n  \}\);/)?.[0] ?? '';
    expect(destroy).toMatch(/editor\.leaveTransform\(\);[^]*flushOnLeave\(\)/);
  });
});

describe('leaving after a failed save', () => {
  it('tries once more — the clock stopped, the leave did not (owner: the draft is written on leaving)', () => {
    // saveNow() gave up at once after a failure, so freeing room in the list
    // and then following a site link lost the drawing without a word.
    expect(fn('flushOnLeave')).toMatch(/saveNow\(false, true\)/);
    expect(fn('saveNow')).toMatch(/saveFailed && !byHand && !leaving/);
  });

  it('says nothing on the way out: the status and the tab’s question are enough', () => {
    expect(fn('saveNow')).toMatch(/if \(leaving\) \{[^}]*saveFailed = true;[^}]*dirty = true;[^}]*\} else \{\s*saveFailedNow\(\);/);
  });
});

describe('the drafts the lists show', () => {
  it('the drafts sheet and the settings write the drawing first: a copy or a download of the current card was a minute old', () => {
    expect(fn('openDrafts')).toMatch(/if \(dirty\) \{?\s*(?:\/\/.*\s*)*await saveNow\(\)[^]*refreshDrafts\(\)/);
    expect(fn('openSettingsSheet')).toMatch(/if \(dirty\) \{?\s*(?:\/\/.*\s*)*void saveNow\(\)/);
  });
});

describe('storage that comes back', () => {
  it('takes the «not saved here» note down once a write lands', () => {
    expect(fn('saveNow')).toMatch(/if \(ok\) \{[^}]*storageBlocked = false;/);
  });
});
