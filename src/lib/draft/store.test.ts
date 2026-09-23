import { afterEach, describe, expect, it, mock } from 'bun:test';
import {
  deleteAllDrafts,
  deleteDraft,
  duplicateDraft,
  exportDrafts,
  importDrafts,
  listDrafts,
  newDraftId,
  saveDraft,
  setDraftAudio,
  setDraftCredits,
  setDraftScreenshot,
} from './store';
import type { DraftState } from './store';

import { createDocument } from '../model/operations';
import { FakeReq, fakeIndexedDB, setIndexedDB, type Stores } from '../test-support/fake-idb';


// A drawing the editor opens: an import drops one that will not.
const doc = (id: number) => ({ ...createDocument(), frame_rate: id });

afterEach(() => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
});

describe('draft store', () => {
  it('lists a saved draft with its document', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(12));
    const drafts = await listDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].id).toBe('a');
    expect(drafts[0].doc).toEqual(doc(12));
    expect(drafts[0].updated).toBeGreaterThan(0);
  });

  it('keeps drafts apart by id, newest first', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('older', doc(1));
    await Bun.sleep(2); // two saves in the same millisecond tie; the clock has to tick
    await saveDraft('newer', doc(2));
    expect((await listDrafts()).map((d) => d.id)).toEqual(['newer', 'older']);
  });

  it('overwrites the same session instead of piling up records', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(1));
    await saveDraft('a', doc(30));
    const drafts = await listDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].doc).toEqual(doc(30));
  });

  it('deletes one draft and leaves the rest', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(1));
    await saveDraft('b', doc(2));
    await deleteDraft('a');
    expect((await listDrafts()).map((d) => d.id)).toEqual(['b']);
  });

  it('is empty when nothing was saved', async () => {
    setIndexedDB(fakeIndexedDB());
    expect(await listDrafts()).toEqual([]);
  });

  it('carries the pre-v2 single draft into the list', async () => {
    const legacy: Stores = new Map([['draft', new Map([['current', doc(24)]])]]);
    setIndexedDB(fakeIndexedDB(legacy));
    const drafts = await listDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].doc).toEqual(doc(24));
  });

  it('mints a distinct id per session', () => {
    expect(newDraftId()).not.toBe(newDraftId());
  });

  it('degrades quietly when another tab blocks the upgrade', async () => {
    // A second tab still holding the old version: the open never proceeds, so
    // the list must give up rather than hang the sheet forever.
    setIndexedDB({
      open() {
        const req = new FakeReq();
        queueMicrotask(() => (req as unknown as { onblocked?: () => void }).onblocked?.());
        return req;
      },
    });
    const warn = mock(() => {});
    const original = console.warn;
    console.warn = warn;
    try {
      expect(await listDrafts()).toEqual([]);
    } finally {
      console.warn = original;
    }
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('reports what the record weighs, so nobody sizes the document again', async () => {
    // The write already serializes the document to size the record; a second
    // `JSON.stringify` on the editor's side was a full pass over every stroke
    // of the drawing, on the main thread, for an indicator.
    setIndexedDB(fakeIndexedDB());
    const written = await saveDraft('a', doc(12));
    expect(written.ok).toBe(true);
    expect(written.bytes).toBe(JSON.stringify(doc(12)).length);
    const [listed] = await listDrafts();
    expect(listed.bytes).toBe(written.bytes);
  });

  it('degrades quietly when IndexedDB is unavailable', async () => {
    // No indexedDB global (bun's default) → best-effort no-op, no throw.
    const warn = mock(() => {});
    const original = console.warn;
    console.warn = warn;
    try {
      // No storage at all is not a failed write: nothing to shout about.
      await expect(saveDraft('a', { any: true })).resolves.toEqual({ ok: true, bytes: 0 });
      await expect(deleteDraft('a')).resolves.toBeUndefined();
      expect(await listDrafts()).toEqual([]);
    } finally {
      console.warn = original;
    }
    expect(warn).toHaveBeenCalledTimes(3);
  });
});

describe('draft export and import', () => {
  it('writes every saved draft to one file and reads them back', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(1));
    await saveDraft('b', doc(2));
    const file = await exportDrafts();

    setIndexedDB(fakeIndexedDB());
    expect(await importDrafts(file)).toEqual({ loaded: 2, broken: 0 });
    const restored = await listDrafts();
    expect(restored.map((d) => d.doc)).toEqual(expect.arrayContaining([doc(1), doc(2)]));
  });

  it('gives an imported draft a fresh id when one is already taken', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(9));
    expect(await importDrafts(JSON.stringify([{ id: 'a', updated: 1, doc: doc(1) }]))).toEqual({ loaded: 1, broken: 0 });
    const drafts = await listDrafts();
    expect(drafts).toHaveLength(2);
    expect(drafts.map((d) => d.doc)).toEqual(expect.arrayContaining([doc(9), doc(1)]));
  });

  it('drops broken records and reports what it loaded', async () => {
    setIndexedDB(fakeIndexedDB());
    const loaded = await importDrafts(JSON.stringify([
      { id: 'ok', updated: 1, doc: doc(3) },
      { updated: 2, doc: doc(4) },
      'мусор',
    ]));
    expect(loaded).toEqual({ loaded: 1, broken: 2 });
    expect((await listDrafts())[0]?.doc).toEqual(doc(3));
  });

  it('loads nothing from a file that is not a draft export', async () => {
    setIndexedDB(fakeIndexedDB());
    expect(await importDrafts('{')).toEqual({ loaded: 0, broken: 0 });
    expect(await listDrafts()).toEqual([]);
  });
});

describe('draft audio track', () => {
  const track = () => ({ blob: new Blob(['ля'], { type: 'audio/mpeg' }), name: 'Песня', author: 'Кто-то' });

  it('keeps the track and its metadata on the draft record', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(12));
    await setDraftAudio('a', track());
    const saved = (await listDrafts())[0];
    expect(saved.audio?.name).toBe('Песня');
    expect(saved.audio?.author).toBe('Кто-то');
    expect(await saved.audio?.blob.text()).toBe('ля');
  });

  it('keeps the track when the document is saved again', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(12));
    await setDraftAudio('a', track());
    await saveDraft('a', doc(24));
    const saved = (await listDrafts())[0];
    expect(saved.doc).toEqual(doc(24));
    expect(saved.audio?.name).toBe('Песня');
  });

  // A track attached before the first write, or before the write that makes
  // a new record after the drawing's own was deleted, had no record to land in
  // and was dropped: the saved drawing came back silent.
  it('a write that makes the record brings the track along', async () => {
    setIndexedDB(fakeIndexedDB());
    await setDraftAudio('a', track());
    await saveDraft('a', doc(12), undefined, track());
    expect((await listDrafts())[0].audio?.name).toBe('Песня');
  });

  it('a track already on the record is not rewritten by a save', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(12));
    await setDraftAudio('a', track());
    await saveDraft('a', doc(24), undefined, { ...track(), name: 'Другая' });
    expect((await listDrafts())[0].audio?.name).toBe('Песня');
  });

  it('replaces one track with another', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(12));
    await setDraftAudio('a', track());
    await setDraftAudio('a', { ...track(), name: 'Другая' });
    expect((await listDrafts())[0].audio?.name).toBe('Другая');
  });

  it('removes the track', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(12));
    await setDraftAudio('a', track());
    await setDraftAudio('a', null);
    expect((await listDrafts())[0].audio).toBeUndefined();
  });

  it('a draft written before tracks existed simply has none', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(12));
    expect((await listDrafts())[0].audio).toBeUndefined();
  });

  it('takes the track into the drafts file, base64-encoded', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(12));
    await setDraftAudio('a', track());
    expect(JSON.parse(await exportDrafts()).saves[0].audio).toBeString();
  });
});

describe('the sync flag rides with the track', () => {
  it('is kept and restored like the credits', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(12));
    await setDraftAudio('a', {
      blob: new Blob(['ля'], { type: 'audio/mpeg' }),
      name: 'Песня',
      author: '',
      sync: false,
    });
    expect((await listDrafts())[0].audio?.sync).toBe(false);
  });

  it('flipping it writes the flag, not the file again', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(12));
    await setDraftAudio('a', {
      blob: new Blob(['ля'], { type: 'audio/mpeg' }),
      name: 'Песня',
      author: 'Автор',
      sync: true,
    });
    await setDraftCredits('a', 'Песня', 'Автор', false);
    const saved = (await listDrafts())[0];
    expect(saved.audio?.sync).toBe(false);
    expect(saved.audio?.name).toBe('Песня');
    expect(await saved.audio?.blob.text()).toBe('ля');
  });

  it('a track saved before the flag existed simply has none', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(12));
    await setDraftAudio('a', { blob: new Blob(['ля'], { type: 'audio/mpeg' }), name: 'П', author: '' });
    expect((await listDrafts())[0].audio?.sync).toBeUndefined();
  });
});

describe('concurrent draft writes', () => {
  const track = () => ({ blob: new Blob(['ля'], { type: 'audio/mpeg' }), name: 'Песня', author: '' });

  it('a document save and a track save at the same moment both land', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(12));
    // Both are fired without awaiting, which is what the editor does: the
    // autosave clock and the track effect are independent. Each is a
    // read-modify-write, so unserialized they overwrite each other's field.
    await Promise.all([saveDraft('a', doc(24)), setDraftAudio('a', track())]);
    const saved = (await listDrafts())[0];
    expect(saved.doc).toEqual(doc(24));
    expect(saved.audio?.name).toBe('Песня');
  });

  it('a burst of credit edits leaves the last one, with the track intact', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(12));
    await setDraftAudio('a', track());
    // Typing a name must not rewrite the file: a 3 MB blob per keystroke is
    // how a draft write turns into a race with itself.
    for (const name of ['П', 'Пе', 'Пес', 'Песн', 'Песня']) {
      await setDraftCredits('a', name, 'Автор', true);
    }
    const saved = (await listDrafts())[0];
    expect(saved.audio?.name).toBe('Песня');
    expect(saved.audio?.author).toBe('Автор');
    expect(await saved.audio?.blob.text()).toBe('ля');
    expect(saved.doc).toEqual(doc(12));
  });

  it('credits for a session with no track are simply dropped', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(12));
    await setDraftCredits('a', 'Песня', 'Автор', true);
    expect((await listDrafts())[0].audio).toBeUndefined();
  });
});

const state: DraftState = {
  frame: 7,
  layer: 2,
  tool: 'feather',
  widths: { pencil: 4, feather: 12 },
  smooth: { feather: 2 },
  minDistance: { feather: 3 },
  outline: '#123456',
  fill: '#ff0000',
  palette: ['#000000', '#123456'],
};

describe('the record carries the session state', () => {
  it('writes the state beside the document and reads it back', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(1), state);
    expect((await listDrafts())[0].state).toEqual(state);
  });

  it('a draft written without one simply has none', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(1));
    expect((await listDrafts())[0].state).toBeUndefined();
  });

  it('keeps the screenshot of the first frame, written on its own', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(1), state);
    await setDraftScreenshot('a', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }));
    const [draft] = await listDrafts();
    expect(await draft.screenshot!.text()).toBe(await new Blob([new Uint8Array([1, 2, 3])]).text());
    expect(draft.state).toEqual(state); // the screenshot write kept the rest
  });

  it('records how much the record weighs, track included', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(1));
    const light = (await listDrafts())[0].bytes!;
    expect(light).toBeGreaterThan(0);
    await setDraftAudio('a', {
      blob: new Blob([new Uint8Array(1024)], { type: 'audio/mpeg' }),
      name: 'Трек',
      author: 'Кто-то',
      sync: true,
      bytes: 1024,
    });
    expect((await listDrafts())[0].bytes!).toBeGreaterThanOrEqual(light + 1024);
  });
});

describe('saveDraft reports whether the write landed', () => {
  it('says yes when the record is on disk', async () => {
    setIndexedDB(fakeIndexedDB());
    expect((await saveDraft('a', doc(1))).ok).toBe(true);
  });

  it('says no when a write into working storage fails', async () => {
    setIndexedDB({
      open() {
        const req = new FakeReq();
        req.result = {
          objectStoreNames: { contains: () => true },
          transaction: () => {
            const tx: Record<string, unknown> = {
              objectStore: () => ({
                get: () => {
                  const r = new FakeReq();
                  queueMicrotask(() => {
                    r.onsuccess?.();
                    (tx.onerror as (() => void) | null)?.();
                  });
                  return r;
                },
                put: () => new FakeReq(),
              }),
              oncomplete: null,
              onerror: null,
              error: new Error('quota exceeded'),
            };
            return tx;
          },
          close() {},
        };
        queueMicrotask(() => req.onsuccess?.());
        return req;
      },
    });
    const original = console.warn;
    console.warn = mock(() => {});
    try {
      expect((await saveDraft('a', doc(1))).ok).toBe(false);
    } finally {
      console.warn = original;
    }
  });
});

describe('copying and clearing the list', () => {
  it('duplicates a draft under a fresh id, leaving the original alone', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(5), state);
    const copy = await duplicateDraft('a');
    const drafts = await listDrafts();
    expect(copy).not.toBe('a');
    expect(drafts).toHaveLength(2);
    expect(drafts.map((d) => d.doc)).toEqual([doc(5), doc(5)]);
    expect(drafts.find((d) => d.id === copy)!.state).toEqual(state);
  });

  it('copies the track along with the drawing', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(5));
    await setDraftAudio('a', { blob: new Blob(['sound']), name: 'Трек', author: 'Кто-то', sync: false });
    const copy = await duplicateDraft('a');
    expect((await listDrafts()).find((d) => d.id === copy)!.audio!.name).toBe('Трек');
  });

  it('duplicating a draft that is not there changes nothing', async () => {
    setIndexedDB(fakeIndexedDB());
    expect(await duplicateDraft('ghost')).toBeNull();
    expect(await listDrafts()).toEqual([]);
  });

  it('deletes every draft at once', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(1));
    await saveDraft('b', doc(2));
    await deleteAllDrafts();
    expect(await listDrafts()).toEqual([]);
  });
});

describe('the .toonio drafts file', () => {
  it('exports the chosen records only, track and screenshot included', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(1), state);
    await setDraftAudio('a', {
      blob: new Blob([new Uint8Array([9, 8, 7])], { type: 'audio/mpeg' }),
      name: 'Трек',
      author: 'Кто-то',
      sync: true,
    });
    await setDraftScreenshot('a', new Blob([new Uint8Array([1, 2])], { type: 'image/webp' }));
    await saveDraft('b', doc(2));

    const file = JSON.parse(await exportDrafts(['a']));
    expect(file.version).toBe(1);
    expect(file.saves).toHaveLength(1);
    expect(JSON.parse(file.saves[0].data)).toEqual(doc(1));
    expect(file.saves[0].audioType).toBe('audio/mpeg');

    setIndexedDB(fakeIndexedDB());
    expect(await importDrafts(JSON.stringify(file))).toEqual({ loaded: 1, broken: 0 });
    const [restored] = await listDrafts();
    expect(restored.doc).toEqual(doc(1));
    expect(restored.state).toEqual(state);
    expect(new Uint8Array(await restored.audio!.blob.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7]));
    expect(restored.audio!.name).toBe('Трек');
    expect(restored.audio!.author).toBe('Кто-то');
    expect(new Uint8Array(await restored.screenshot!.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
  });

  it('counts the records it could not read', async () => {
    setIndexedDB(fakeIndexedDB());
    const report = await importDrafts(JSON.stringify({
      version: 1,
      saves: [
        { id: 'a', updated: 1, data: JSON.stringify(doc(1)) },
        { id: 'b', updated: 2, data: '{not json' },
        'мусор',
      ],
    }));
    expect(report).toEqual({ loaded: 1, broken: 2 });
    expect((await listDrafts())[0].doc).toEqual(doc(1));
  });

  it('exports every draft when nothing is chosen', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(1));
    await saveDraft('b', doc(2));
    expect(JSON.parse(await exportDrafts()).saves).toHaveLength(2);
  });

  it('reports its progress record by record, so a long export has a bar', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(1));
    await saveDraft('b', doc(2));
    const steps: [number, number][] = [];
    await exportDrafts(undefined, (done, total) => steps.push([done, total]));
    expect(steps).toEqual([[1, 2], [2, 2]]);
  });
});

describe('a write that arrives after the record was deleted', () => {
  it('does not resurrect it as a stub — the screenshot lands late, in idle time', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(1));
    await deleteDraft('a');
    await setDraftScreenshot('a', new Blob(['webp']));
    expect(await listDrafts()).toEqual([]);
  });

  it('the same for the track and its credits', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(1));
    await deleteDraft('a');
    await setDraftAudio('a', { blob: new Blob(['sound']), name: 'Трек', author: '' });
    await setDraftCredits('a', 'Трек', 'Кто-то', true);
    expect(await listDrafts()).toEqual([]);
  });

  it('«удалить все» stays deleted even with a screenshot still in flight', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(1));
    await saveDraft('b', doc(2));
    const late = setDraftScreenshot('a', new Blob(['webp']));
    await deleteAllDrafts();
    await late;
    expect(await listDrafts()).toEqual([]);
  });
});

// Every write weighed the record by serialising the whole document, the
// screenshot written a few seconds after each autosave included — a second
// full pass over every stroke on the main thread for a document it did not
// touch. And every write opened and closed the database again.
describe('a side write does not weigh the document again', () => {
  it('the screenshot write carries the size over instead of stringifying', async () => {
    setIndexedDB(fakeIndexedDB());
    const written = await saveDraft('a', doc(1));
    const stringify = JSON.stringify;
    let calls = 0;
    JSON.stringify = ((...args: Parameters<typeof stringify>) => {
      calls++;
      return stringify(...args);
    }) as typeof stringify;
    try {
      await setDraftScreenshot('a', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }));
    } finally {
      JSON.stringify = stringify;
    }
    expect(calls).toBe(0);
    expect((await listDrafts())[0].bytes).toBe(written.bytes + 3);
  });

  it('writes share one connection', async () => {
    const fake = fakeIndexedDB() as { open: (...args: unknown[]) => unknown };
    let opens = 0;
    setIndexedDB({ open: (...args: unknown[]) => (opens++, fake.open(...args)) });
    await saveDraft('a', doc(1));
    await saveDraft('a', doc(2));
    await setDraftScreenshot('a', new Blob([new Uint8Array([1])]));
    expect(opens).toBe(1);
  });
});
