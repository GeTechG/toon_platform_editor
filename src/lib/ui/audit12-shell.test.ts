import { afterEach, describe, expect, it, mock } from 'bun:test';
import { keyOwner, latinKey, type KeyTarget } from './key-owner';
import { createDocument } from '../model/operations';
import { importDrafts, listDrafts, saveDraft } from '../draft/store';
import { FakeReq, fakeIndexedDB, setIndexedDB } from '../test-support/fake-idb';

// Twelfth audit, the studio shell. Editor.svelte is asserted as source, like
// audit11-shell.test.ts; what can run for real (the key rule, the store) does.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

const doc = (fps: number) => ({ ...createDocument(), frame_rate: fps });

/** A fake IndexedDB whose puts fail once `full.on` is set — a full quota. */
function fillableIdb(): { on: boolean } {
  const full = { on: false };
  const inner = fakeIndexedDB() as { open(): FakeReq };
  setIndexedDB({
    open() {
      const req = inner.open();
      const db = req.result as { transaction(): { onerror: (() => void) | null; objectStore(n: string): { put: unknown } } };
      const open = db.transaction.bind(db);
      db.transaction = () => {
        const tx = open();
        if (full.on) {
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
  return full;
}

async function quietly<T>(run: () => Promise<T>): Promise<T> {
  const warn = console.warn;
  console.warn = mock(() => {});
  try {
    return await run();
  } finally {
    console.warn = warn;
  }
}

describe('loading a drafts file', () => {
  afterEach(() => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  it('into full storage fails instead of counting what never landed', async () => {
    // Both callers catch a throw as «хранилище браузера не приняло их»; the
    // store never threw, so a full quota read «Загружено черновиков: 2».
    const full = fillableIdb();
    await saveDraft('a', doc(1));
    full.on = true;
    const file = JSON.stringify([{ id: 'b', updated: 1, doc: doc(2) }]);
    await expect(quietly(() => importDrafts(file))).rejects.toThrow();
    expect(await listDrafts()).toHaveLength(1);
  });

  it('counts a record whose drawing will not open as broken, not loaded', async () => {
    // The list drops such a record when it reads it, so «загружено: 2»
    // showed one card.
    setIndexedDB(fakeIndexedDB());
    const file = JSON.stringify([
      { id: 'ok', updated: 1, doc: doc(3) },
      { id: 'bad', updated: 2, doc: { nothing: 'here' } },
    ]);
    expect(await importDrafts(file)).toEqual({ loaded: 1, broken: 1 });
    expect((await listDrafts()).map((d) => d.id)).toEqual(['ok']);
  });
});

describe('a chord the browser owns', () => {
  const body: KeyTarget = { tagName: 'BODY', isContentEditable: false, getAttribute: () => null, matches: () => false };
  const press = (key: string) =>
    keyOwner({ key, target: body, defaultPrevented: false, ctrlKey: true, metaKey: false, modalOpen: false, letterKeys: true });

  it('stays the browser’s: Ctrl +/− zoom the page, Ctrl+L, P, F, D, H, J, O are not tools', () => {
    // Every Ctrl chord went down the hotkey table and was prevented: Ctrl+=
    // thickened the brush instead of zooming the page (WCAG 1.4.4), Ctrl+P
    // picked the pipette instead of printing, Ctrl+L took the address bar.
    // Ctrl+X is the studio's cut since the owner's twelfth answers.
    for (const key of ['=', '+', '-', '_', 'l', 'p', 'f', 'd', 'h', 'j', 'o', 'b', 'k', 'e', ' ']) {
      expect(press(key)).toBe('control');
    }
  });

  it('keeps the reference’s own: Ctrl+Z, Y, C, V, M, A, F7 and Ctrl+Shift+Z', () => {
    for (const key of ['z', 'Z', 'y', 'Y', 'c', 'C', 'v', 'V', 'm', 'M', 'a', 'A', 'F7']) {
      expect(press(key)).toBe('editor');
    }
  });
});

describe('a dead key', () => {
  it('is read by where it sits: Option+E on a Mac is Alt+E', () => {
    // macOS types Option+E as a dead accent: `key` is «Dead», and the
    // mega-eraser never came up there.
    expect(latinKey({ key: 'Dead', code: 'KeyE' })).toBe('e');
    // US-International makes ` a dead key: the distort was out of reach.
    expect(latinKey({ key: 'Dead', code: 'Backquote' })).toBe('`');
    // A dead key off the letters stays what it is.
    expect(latinKey({ key: 'Dead', code: 'Quote' })).toBe('Dead');
  });
});

describe('a track that did not fit', () => {
  it('is a failed save: said, retried by hand, and the tab warns before closing', () => {
    // The track write's answer was dropped: storage full, the track never
    // reached the record, the status said nothing and the tab closed quietly.
    expect(editorUi).toMatch(/setDraftAudio\([^]*?\)\.then\(\(ok\) => \{\s*if \(!ok && blob\) \{\s*(?:\/\/.*\s*)*saveFailedNow\(\);/);
    expect(editorUi).toMatch(/function saveFailedNow\(\): void \{\s*saveFailed = true;\s*dirty = true;\s*alert\(t\('editor\.save_failed_alert'\)\);/);
  });
});

function fn(name: string): string {
  const match = editorUi.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

describe('opening a draft over a drawing', () => {
  it('asks, as opening a file does, and the draft is written before it goes', () => {
    // Alt+Enter no longer mutes the question (owner-twelfth-shell).
    expect(fn('openDraft')).toMatch(/if \(editor\.touched\) \{\s*if \(!confirm\(t\('editor\.draft_open_confirm'\)\)\) \{\s*return;\s*\}\s*(?:\/\/.*\s*)*if \(!\(await saveNow\(true\)\)\)/);
  });
});

describe('a file dropped during an update', () => {
  it('is taken from the browser and left alone: the lock says nothing is to be touched', () => {
    expect(fn('onDrop')).toMatch(/e\.preventDefault\(\);\s*(?:\/\/.*\s*)*if \(editor\.updating\) \{\s*return;\s*\}/);
  });
});

describe('the hand a drafts file brings', () => {
  afterEach(() => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  const good = {
    frame: 0, layer: 0, tool: 'pencil', widths: { pencil: 9 }, smooth: { pencil: 3 }, minDistance: { pencil: 3 },
    outline: '#123456', fill: '#ff0000', palette: ['#000000'], layerColors: [0],
  };
  const load = async (state: unknown) => {
    setIndexedDB(fakeIndexedDB());
    await importDrafts(JSON.stringify([{ id: 'a', updated: 1, doc: doc(12), state }]));
    return (await listDrafts())[0];
  };

  it('is kept when it is one the editor wrote', async () => {
    expect((await load(good)).state).toEqual(good);
  });

  it('is left behind when it is not: a colour the document refuses would lose the drawing', async () => {
    // The file is from anywhere. «red» went straight into the brush, every
    // stroke after it failed the schema, and the draft dropped off the list.
    for (const bad of [
      { ...good, outline: 'red' },
      { ...good, fill: 42 },
      { ...good, palette: ['#000000', null] },
      { ...good, widths: { pencil: 'толстая' } },
      { ...good, frame: 'last' },
      { ...good, layerColors: 'all' },
      'мусор',
    ]) {
      const record = await load(bad);
      expect(record.id).toBe('a');
      expect(record.state).toBeUndefined();
    }
  });
});
