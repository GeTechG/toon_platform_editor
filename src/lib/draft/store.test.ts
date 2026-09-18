import { afterEach, describe, expect, it, mock } from 'bun:test';
import {
  deleteDraft,
  exportDrafts,
  importDrafts,
  listDrafts,
  newDraftId,
  saveDraft,
  setDraftAudio,
} from './store';

/**
 * Minimal in-memory IndexedDB fake — enough for the keyPath store the draft
 * list needs: open → (upgrade with the previous version) → success, readwrite
 * put/delete completing via tx.oncomplete, readonly getAll returning via
 * request.onsuccess.
 */
class FakeReq {
  result: unknown;
  error: unknown = null;
  transaction: FakeTx | null = null;
  onsuccess: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  onerror: (() => void) | null = null;
}

type Stores = Map<string, Map<string, unknown>>;

class FakeObjectStore {
  constructor(
    private data: Map<string, unknown>,
    private tx: FakeTx,
    private keyPath: string | null,
  ) {}
  get(key: string): FakeReq {
    const req = new FakeReq();
    req.result = this.data.get(key);
    queueMicrotask(() => req.onsuccess?.());
    return req;
  }
  getAll(): FakeReq {
    const req = new FakeReq();
    req.result = [...this.data.values()];
    queueMicrotask(() => req.onsuccess?.());
    return req;
  }
  put(value: unknown, key?: string): FakeReq {
    const id = this.keyPath ? String((value as Record<string, unknown>)[this.keyPath]) : String(key);
    this.data.set(id, value);
    queueMicrotask(() => this.tx.oncomplete?.());
    return new FakeReq();
  }
  delete(key: string): FakeReq {
    this.data.delete(key);
    queueMicrotask(() => this.tx.oncomplete?.());
    return new FakeReq();
  }
}

class FakeTx {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(private stores: Stores) {}
  objectStore(name: string): FakeObjectStore {
    const data = this.stores.get(name) ?? new Map();
    this.stores.set(name, data);
    return new FakeObjectStore(data, this, name === 'drafts' ? 'id' : null);
  }
}

class FakeDb {
  constructor(private stores: Stores) {}
  get objectStoreNames(): { contains: (name: string) => boolean } {
    return { contains: (name: string) => this.stores.has(name) };
  }
  createObjectStore(name: string): FakeObjectStore {
    const data = new Map<string, unknown>();
    this.stores.set(name, data);
    return new FakeObjectStore(data, new FakeTx(this.stores), name === 'drafts' ? 'id' : null);
  }
  transaction(): FakeTx {
    return new FakeTx(this.stores);
  }
  close(): void {}
}

/** A fake whose storage starts at `stores` — used to plant a pre-v2 draft. */
function fakeIndexedDB(stores: Stores = new Map()): unknown {
  const state = { version: stores.size > 0 ? 1 : 0, stores };
  return {
    open() {
      const req = new FakeReq();
      req.result = new FakeDb(state.stores);
      queueMicrotask(() => {
        if (state.version < 2) {
          state.version = 2;
          req.transaction = new FakeTx(state.stores);
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });
      return req;
    },
  };
}

function setIndexedDB(value: unknown): void {
  (globalThis as { indexedDB?: unknown }).indexedDB = value;
}

const doc = (id: number) => ({
  schema_version: 1, width: 4800, height: 2400, frame_rate: id, frames: [{ strokes: [] }],
});

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

  it('degrades quietly when IndexedDB is unavailable', async () => {
    // No indexedDB global (bun's default) → best-effort no-op, no throw.
    const warn = mock(() => {});
    const original = console.warn;
    console.warn = warn;
    try {
      await expect(saveDraft('a', { any: true })).resolves.toBeUndefined();
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
    expect(await importDrafts(file)).toEqual({ loaded: 2 });
    const restored = await listDrafts();
    expect(restored.map((d) => d.doc)).toEqual(expect.arrayContaining([doc(1), doc(2)]));
  });

  it('gives an imported draft a fresh id when one is already taken', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(9));
    expect(await importDrafts(JSON.stringify([{ id: 'a', updated: 1, doc: doc(1) }]))).toEqual({ loaded: 1 });
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
    expect(loaded).toEqual({ loaded: 1 });
    expect((await listDrafts())[0]?.doc).toEqual(doc(3));
  });

  it('loads nothing from a file that is not a draft export', async () => {
    setIndexedDB(fakeIndexedDB());
    expect(await importDrafts('{')).toEqual({ loaded: 0 });
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

  it('leaves the track out of the drafts file — JSON carries no blob', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(12));
    await setDraftAudio('a', track());
    expect(JSON.parse(await exportDrafts())[0].audio).toBeUndefined();
  });
});
