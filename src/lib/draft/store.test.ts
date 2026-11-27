import { afterEach, describe, expect, it, mock } from 'bun:test';
import {
  deleteAllDrafts,
  deleteDraft,
  deleteDraftIfVersion,
  duplicateDraft,
  exportDrafts,
  importDrafts,
  listDraftCards,
  listDrafts,
  newDraftId,
  onDraftFailure,
  readDraft,
  saveDraft,
  setDraftAudio,
  setDraftCredits,
  setDraftScreenshot,
} from './store';
import type { DraftState } from './store';
import { DRAFTS_CHANNEL } from './store';

import { addStroke, createDocument } from '../model/operations';
import { packDocument } from '../format/pack';
import { decodeProject } from '../format/project';
import { FakeReq, fakeIndexedDB, fakeReads, setIndexedDB, type Stores } from '../test-support/fake-idb';


// A drawing the editor opens: an import drops one that will not.
const doc = (id: number) => ({ ...createDocument(), frame_rate: id });

afterEach(() => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
});

describe('draft store', () => {
  it('restores a mixed draft and its raster images through a backup on a fresh device', async () => {
    const hash = '4b23c031ae6c12e8d0f76e5d2161749f4a1f92e515c5b7c44eafa4b404fed421';
    const image = Uint8Array.fromBase64('UklGRh4AAABXRUJQVlA4TBEAAAAvAQAAAA+w//Mf8x8VMqL/AQA=');
    const project = createDocument();
    project.layers.push({
      kind: 'raster',
      hidden: false,
      frames: [{ strokes: [], raster: { hash, x: 20, y: 10, width: 2, height: 1 } }],
    });

    setIndexedDB(fakeIndexedDB());
    expect((await saveDraft('art', project, undefined, undefined, {
      rasterAssets: new Map([[hash, new Blob([image], { type: 'image/webp' })]]),
    })).ok).toBe(true);
    const backup = await exportDrafts(['art']);

    setIndexedDB(fakeIndexedDB());
    expect(await importDrafts(backup)).toEqual({ loaded: 1, broken: 0 });
    expect((await readDraft('art'))?.doc).toEqual(project);
    const reexported = JSON.parse(await exportDrafts(['art'])).saves[0].project as string;
    const portable = await decodeProject(new Blob([Uint8Array.fromBase64(reexported)]));
    expect(new Uint8Array(await portable.assets.get(hash)!.arrayBuffer())).toEqual(image);
  });

  it('keeps the last saved draft if an edit needs a missing raster image', async () => {
    setIndexedDB(fakeIndexedDB());
    const previous = doc(12);
    expect((await saveDraft('art', previous)).ok).toBe(true);
    const edited = doc(12);
    edited.layers.push({
      hidden: false,
      kind: 'raster',
      frames: [{ strokes: [], raster: { hash: '1'.repeat(64), x: 0, y: 0, width: 1, height: 1 } }],
    });

    expect((await saveDraft('art', edited)).ok).toBe(false);
    expect((await readDraft('art'))?.doc).toEqual(previous);
  });

  it.each([false, true])('captures the document before waiting for audio (starts mixed: %s)', async (mixed) => {
    setIndexedDB(fakeIndexedDB());
    const draft = createDocument();
    if (mixed) draft.layers.push({ hidden: false, kind: 'raster', frames: [{ strokes: [] }] });
    const original = structuredClone(draft);
    let started!: () => void;
    let finish!: () => void;
    const startedReading = new Promise<void>((resolve) => { started = resolve; });
    const finishReading = new Promise<void>((resolve) => { finish = resolve; });
    const blob = new Blob(['track']);
    const read = blob.arrayBuffer.bind(blob);
    blob.arrayBuffer = async () => {
      started();
      await finishReading;
      return read();
    };

    const save = saveDraft('art', draft, undefined, { blob, name: 'song', author: 'me' });
    await startedReading;
    const added = { strokes: [], raster: { hash: '1'.repeat(64), x: 0, y: 0, width: 1, height: 1 } };
    if (mixed) draft.layers[1].frames[0] = added;
    else draft.layers.push({ hidden: false, kind: 'raster', frames: [added] });
    finish();
    expect((await save).ok).toBe(true);
    expect((await readDraft('art'))?.doc).toEqual(original);
  });

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

  it('only removes the submitted draft version, even if the next save shares its timestamp', async () => {
    setIndexedDB(fakeIndexedDB());
    const now = Date.now;
    Date.now = () => 42;
    try {
      const initial = await saveDraft('a', doc(12));
      expect(initial.version).toBeDefined();
      await saveDraft('a', doc(24));
      expect(await deleteDraftIfVersion('a', initial.version!)).toBe(false);
      const newer = await readDraft('a');
      expect(newer?.doc).toEqual(doc(24));
      expect(await deleteDraftIfVersion('a', newer!.version!)).toBe(true);
      expect(await readDraft('a')).toBeNull();
    } finally {
      Date.now = now;
    }
  });

  it('keeps a draft whose soundtrack changed after submission', async () => {
    setIndexedDB(fakeIndexedDB());
    const original = await saveDraft('a', doc(12), undefined, { blob: new Blob(['original']), name: 'song', author: 'me' });
    await setDraftCredits('a', 'new title', 'me', true);
    expect(await deleteDraftIfVersion('a', original.version!)).toBe(false);
    expect((await readDraft('a'))?.audio?.name).toBe('new title');
  });

  it('returns the committed versions of track and credit changes', async () => {
    setIndexedDB(fakeIndexedDB());
    const first = await saveDraft('a', doc(12));
    const attached = await setDraftAudio('a', { blob: new Blob(['track']), name: 'song', author: 'me' }, first.version!);
    expect(attached.version).toBeDefined();
    const credited = await setDraftCredits('a', 'edited', 'me', false, attached.version!);
    expect(credited.version).toBeDefined();
    expect(await deleteDraftIfVersion('a', credited.version!)).toBe(true);
  });

  it('reports a temporarily unreadable soundtrack and keeps the recoverable draft', async () => {
    const stores: Stores = new Map();
    setIndexedDB(fakeIndexedDB(stores));
    await saveDraft('a', doc(12), undefined, { blob: new Blob(['track']), name: 'song', author: 'me' });
    const media = stores.get('draft-audio')!;
    const [key, value] = [...media][0];
    media.delete(key);
    const incomplete = await readDraft('a');
    expect(incomplete).toMatchObject({ audioUnavailable: true, doc: doc(12) });
    expect(incomplete?.audio).toBeUndefined();
    media.set(key, value);
    expect(await deleteDraftIfVersion('a', incomplete!.version!)).toBe(false);
    expect((await readDraft('a'))?.audio?.name).toBe('song');
  });

  it('reports a newer document before writing an older autosave or track', async () => {
    setIndexedDB(fakeIndexedDB());
    const first = await saveDraft('a', doc(12));
    await saveDraft('a', doc(24));
    const write = await saveDraft('a', doc(12), undefined, null, { expectedVersion: first.version! });
    expect(write).toMatchObject({ ok: false, conflict: true });
    const track = await setDraftAudio('a', { blob: new Blob(['track']), name: 'song', author: 'me' }, first.version!);
    expect(track).toMatchObject({ ok: false, conflict: true });
    expect((await readDraft('a'))?.doc).toEqual(doc(24));
    expect((await readDraft('a'))?.audio).toBeUndefined();
  });

  it('keeps a same-millisecond edit from an older tab that copied the version metadata', async () => {
    const stores: Stores = new Map();
    setIndexedDB(fakeIndexedDB(stores));
    const original = await saveDraft('a', doc(12));
    const drafts = stores.get('drafts')!;
    const saved = drafts.get('a') as Record<string, unknown>;
    drafts.set('a', { ...saved, packed: new TextEncoder().encode(JSON.stringify(packDocument(doc(24)))) });
    expect(await deleteDraftIfVersion('a', original.version!)).toBe(false);
    expect((await readDraft('a'))?.doc).toEqual(doc(24));
  });

  it('preserves a newer stored draft if publication tries to save the earlier version', async () => {
    setIndexedDB(fakeIndexedDB());
    const original = await saveDraft('a', doc(12));
    await saveDraft('a', doc(24));
    const result = await saveDraft('a', doc(12), undefined, null, {
      forPublication: true, expectedVersion: original.version!,
    });
    expect(result).toMatchObject({ ok: false, conflict: true });
    expect((await readDraft('a'))?.doc).toEqual(doc(24));
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
    // The document is kept as the bytes of its packed text: those are what it weighs.
    expect(written.bytes).toBe(new TextEncoder().encode(JSON.stringify(packDocument(doc(12)))).length);
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

  it('allows discarding an unsavable drawing, but requires a write for publication', async () => {
    const expectedVersion = null;
    await expect(saveDraft('a', doc(12), undefined, null, { expectedVersion })).resolves.toEqual({ ok: true, bytes: 0 });
    const track = { blob: new Blob(['sound']), name: 'Track', author: '' };
    await expect(saveDraft('a', doc(12), undefined, track, { expectedVersion, replaceAudio: true })).resolves.toEqual({ ok: true, bytes: 0 });
    await expect(saveDraft('a', doc(12), undefined, null, { expectedVersion, forPublication: true })).resolves.toEqual({ ok: false, bytes: 0 });
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

describe('local draft for a publication', () => {
  const forPublication = { forPublication: true };

  it('keeps the previous version if replacement audio fails and saves the current track on retry', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(12));
    await setDraftAudio('a', { blob: new Blob(['old']), name: 'Track', author: '' });
    const blob = new Blob(['new']);
    const read = blob.arrayBuffer.bind(blob);
    blob.arrayBuffer = async () => { throw new DOMException('unreadable', 'NotReadableError'); };
    const audio = { blob, name: 'Track', author: '' };

    expect((await saveDraft('a', doc(24), undefined, audio, forPublication)).ok).toBe(false);
    expect((await readDraft('a'))?.doc).toEqual(doc(12));
    expect(await (await readDraft('a'))?.audio?.blob.text()).toBe('old');

    blob.arrayBuffer = read;
    expect((await saveDraft('a', doc(24), undefined, audio, forPublication)).ok).toBe(true);
    expect((await readDraft('a'))?.doc).toEqual(doc(24));
    expect(await (await readDraft('a'))?.audio?.blob.text()).toBe('new');
  });

  it('reuses restored audio, updates its credits and lets the card draw the new frame', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(12));
    await setDraftAudio('a', { blob: new Blob(['sound']), name: 'Track', author: '' });
    await setDraftScreenshot('a', new Blob(['old thumbnail']));
    const restored = (await readDraft('a'))!.audio!;
    restored.blob.arrayBuffer = async () => { throw new Error('already stored'); };

    const next = doc(24);
    expect((await saveDraft('a', next, undefined, { ...restored, name: 'New credits' }, forPublication)).ok).toBe(true);
    expect((await readDraft('a'))?.audio?.name).toBe('New credits');
    expect(await (await readDraft('a'))?.audio?.blob.text()).toBe('sound');
    const [card] = await listDraftCards();
    expect(card.screenshot).toBeUndefined();
    expect(card.doc).toEqual(next);
  });

  it('keeps the current version silent even if the earlier draft had audio', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(12));
    await setDraftAudio('a', { blob: new Blob(['old']), name: 'Track', author: '' });

    expect((await saveDraft('a', doc(24), undefined, null, forPublication)).ok).toBe(true);
    expect((await readDraft('a'))?.audio).toBeUndefined();
  });

  it('retries a failed soundtrack removal with a version-checked drawing save', async () => {
    const stores: Stores = new Map();
    const storage = fakeIndexedDB(stores) as { open(): FakeReq };
    setIndexedDB(storage);
    await saveDraft('a', doc(12));
    const { version } = await setDraftAudio('a', { blob: new Blob(['sound']), name: 'Track', author: '' });
    expect(version).toBeDefined();
    setIndexedDB({
      open() {
        const request = storage.open();
        const db = request.result as IDBDatabase;
        const transaction = db.transaction.bind(db);
        db.transaction = (names, mode) => {
          const tx = transaction(names, mode);
          const objectStore = tx.objectStore.bind(tx);
          tx.objectStore = (name) => {
            const store = objectStore(name);
            if (mode === 'readwrite') {
              store.put = () => { throw new DOMException('full', 'QuotaExceededError'); };
            }
            return store;
          };
          return tx;
        };
        return request;
      },
    });
    expect(await setDraftAudio('a', null, version)).toEqual({ ok: false });
    expect((await readDraft('a'))?.audio?.name).toBe('Track');

    setIndexedDB(storage);
    const options = { expectedVersion: version, replaceAudio: true };
    expect((await saveDraft('a', doc(24), undefined, null, options)).ok).toBe(true);
    expect((await readDraft('a'))?.audio).toBeUndefined();
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
    const broken = () => setIndexedDB({
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
                    const failure = new DOMException('private draft name', 'QuotaExceededError');
                    (tx.onerror as (event: unknown) => void)({ target: { error: failure } });
                    tx.error = failure;
                    (tx.onabort as () => void)();
                  });
                  return r;
                },
                put: () => new FakeReq(),
              }),
              oncomplete: null,
              onerror: null,
              error: null,
            };
            return tx;
          },
          close() {},
        };
        queueMicrotask(() => req.onsuccess?.());
        return req;
      },
    });
    const heard: unknown[] = [];
    const stop = onDraftFailure((operation, cause) => heard.push([operation, cause]));
    broken();
    const original = console.warn;
    console.warn = mock(() => {});
    try {
      // Nothing landed, so nothing is weighed: a size here would be shown
      // as the size of a draft that is not on disk.
      expect(await saveDraft('a', doc(1))).toEqual({ ok: false, bytes: 0 });
      await saveDraft('a', doc(1));
      setIndexedDB(fakeIndexedDB());
      expect((await saveDraft('a', doc(1))).ok).toBe(true);
      broken();
      await saveDraft('a', doc(1));
      expect(heard).toEqual([['draft save', 'QuotaExceededError'], ['draft save', 'QuotaExceededError']]);
    } finally {
      stop();
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

describe('a write does not read the document back', () => {
  const track = () => ({ blob: new Blob([new Uint8Array([1, 2])]), name: 'song', author: 'me' });

  it('a second save by the same tab reads nothing and keeps the track and the screenshot', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', doc(1));
    await setDraftAudio('a', track());
    await setDraftScreenshot('a', new Blob([new Uint8Array([7])]));
    fakeReads.count = 0;
    await saveDraft('a', doc(2));
    await setDraftScreenshot('a', new Blob([new Uint8Array([8])]));
    expect(fakeReads.count).toBe(0);
    const [record] = await listDrafts();
    expect(record.doc).toEqual(doc(2));
    expect(record.audio?.name).toBe('song');
    expect(record.screenshot?.size).toBe(1);
  });

  it('reads the record again once another tab has written it', async () => {
    const stores: Stores = new Map();
    setIndexedDB(fakeIndexedDB(stores));
    await saveDraft('a', doc(1));
    // Another tab attaches a track to the same draft and says so.
    const drafts = stores.get('drafts')!;
    drafts.set('a', { ...(drafts.get('a') as object), audio: track() });
    const other = new BroadcastChannel(DRAFTS_CHANNEL);
    other.postMessage({ id: 'a' });
    other.close();
    await Bun.sleep(5);
    await saveDraft('a', doc(2));
    const [record] = await listDrafts();
    expect(record.doc).toEqual(doc(2));
    expect(record.audio?.name).toBe('song');
  });
});

describe('the document is kept as bytes', () => {
  const drawn = () => {
    const built = createDocument();
    addStroke(built, 0, 0, { points: [10, 20, 300, 400, 500, 20], width: 9, color: '#123456' });
    return built;
  };

  it('stores one array of bytes, not the tree of strokes, and hands the document back', async () => {
    const stores: Stores = new Map();
    setIndexedDB(fakeIndexedDB(stores));
    await saveDraft('a', drawn());
    const raw = stores.get('drafts')!.get('a') as Record<string, unknown>;
    expect(raw.doc).toBeUndefined();
    expect(raw.packed).toBeInstanceOf(Uint8Array);
    const [listed] = await listDrafts();
    expect(listed.doc).toEqual(drawn());
  });

  it('reads a record written before, with the document as it was', async () => {
    const stores: Stores = new Map();
    setIndexedDB(fakeIndexedDB(stores));
    await saveDraft('new', doc(1));
    stores.get('drafts')!.set('old', { id: 'old', updated: 1, doc: drawn() });
    const old = (await listDrafts()).find((d) => d.id === 'old')!;
    expect(old.doc).toEqual(drawn());
  });

  it('a copy and the drafts file carry the document', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', drawn());
    const copy = await duplicateDraft('a');
    const listed = (await listDrafts()).find((d) => d.id === copy)!;
    expect(listed.doc).toEqual(drawn());
  });
});


describe('the list reads cards, not documents', () => {
  const drawn = () => {
    const built = createDocument();
    addStroke(built, 0, 0, { points: [10, 20, 300, 400, 500, 20], width: 9, color: '#123456' });
    return built;
  };

  it('a card carries the sheet, the frames and the layers, and the document is read on opening', async () => {
    setIndexedDB(fakeIndexedDB());
    const written = drawn();
    await saveDraft('a', written);
    await setDraftScreenshot('a', new Blob([new Uint8Array([1])]));
    const [card] = await listDraftCards();
    expect(card.id).toBe('a');
    expect(card.summary).toEqual({ width: written.width, height: written.height, frames: 1, layers: written.layers.length });
    expect(card.doc).toBeUndefined();
    expect((await readDraft('a'))?.doc).toEqual(written);
  });

  it('a document spoilt after it was written still lists, and does not open', async () => {
    const stores: Stores = new Map();
    setIndexedDB(fakeIndexedDB(stores));
    await saveDraft('a', drawn());
    const drafts = stores.get('drafts')!;
    drafts.set('a', { ...(drafts.get('a') as object), packed: new TextEncoder().encode('{"not a toon"') });
    expect((await listDraftCards()).map((c) => c.id)).toEqual(['a']);
    expect(await readDraft('a')).toBeNull();
  });

  it('a record written before the cards is read once and gets its card', async () => {
    const stores: Stores = new Map();
    setIndexedDB(fakeIndexedDB(stores));
    stores.set('drafts', new Map([['old', { id: 'old', updated: 1, doc: drawn() }]]));
    const [card] = await listDraftCards();
    expect(card.summary?.frames).toBe(1);
    await Bun.sleep(5);
    const raw = stores.get('drafts')!.get('old') as Record<string, unknown>;
    expect(raw.summary).toEqual(card.summary);
  });

  it('a record written before the cards that does not read stays out of the list', async () => {
    const stores: Stores = new Map();
    setIndexedDB(fakeIndexedDB(stores));
    await saveDraft('good', drawn());
    stores.get('drafts')!.set('bad', { id: 'bad', updated: 1, doc: { layers: 'no' } });
    expect((await listDraftCards()).map((c) => c.id)).toEqual(['good']);
  });

  it('a record before the cards that has layers and still does not read stays out on every list', async () => {
    const stores: Stores = new Map();
    setIndexedDB(fakeIndexedDB(stores));
    stores.set('drafts', new Map([['bad', { id: 'bad', updated: 1, doc: { ...drawn(), schema_version: 6 } }]]));
    expect(await listDraftCards()).toEqual([]);
    await Bun.sleep(5);
    expect(await listDraftCards()).toEqual([]);
  });

  it('a record before the cards whose frames are not frames is marked, not packed', async () => {
    const stores: Stores = new Map();
    setIndexedDB(fakeIndexedDB(stores));
    const doc = { layers: [{ frames: 'invalid' }] };
    stores.set('drafts', new Map([['bad', { id: 'bad', updated: 1, doc }]]));
    expect(await listDraftCards()).toEqual([]);
    await Bun.sleep(5);
    const raw = stores.get('drafts')!.get('bad') as Record<string, unknown>;
    expect(raw.broken).toBe(true);
    expect(raw.doc).toEqual(doc);
  });

  it('a drawing saved over a record that did not read lists again', async () => {
    const stores: Stores = new Map();
    setIndexedDB(fakeIndexedDB(stores));
    stores.set('drafts', new Map([['bad', { id: 'bad', updated: 1, doc: { ...drawn(), schema_version: 6 } }]]));
    await listDraftCards();
    await Bun.sleep(5);
    await saveDraft('bad', drawn());
    expect((await listDraftCards()).map((c) => c.id)).toEqual(['bad']);
  });

  it('a screenshot that lands after the draft was deleted leaves no card', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', drawn());
    await deleteDraft('a');
    await setDraftScreenshot('a', new Blob([new Uint8Array([1])]));
    expect(await listDraftCards()).toEqual([]);
  });

  it('a card with no screenshot brings the document for its first frame', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', drawn());
    await saveDraft('b', drawn());
    await setDraftScreenshot('b', new Blob([new Uint8Array([1])]));
    const cards = await listDraftCards();
    expect(cards.find((c) => c.id === 'a')!.doc).toEqual(drawn());
    expect(cards.find((c) => c.id === 'b')!.doc).toBeUndefined();
  });

  it('a version 7 draft opens on the drawing it was left on, its pauses unrolled before it', async () => {
    // Held 3 ticks, then 1: the second drawing was column 1 and is tick 3 now.
    setIndexedDB(fakeIndexedDB());
    const cell = { strokes: [] };
    const v7 = {
      schema_version: 7, width: 4800, height: 2400, frame_rate: 12, tools: [],
      layers: [{ hidden: false, frames: [cell, cell] }], holds: [3, 1],
    };
    await saveDraft('a', v7, { ...state, frame: 1 });
    const opened = await readDraft('a');
    expect(opened?.doc.layers[0].frames).toEqual([cell, null, null, cell]);
    expect(opened?.state?.frame).toBe(3);
    expect((await listDraftCards())[0].summary?.frames).toBe(4);
  });

  it('a copy keeps the drawing without reading it', async () => {
    setIndexedDB(fakeIndexedDB());
    await saveDraft('a', drawn());
    const copy = await duplicateDraft('a');
    expect((await readDraft(copy!))?.doc).toEqual(drawn());
    expect((await listDraftCards()).find((c) => c.id === copy)!.summary?.frames).toBe(1);
  });
});

function containsBlob(value: unknown): boolean {
  if (value instanceof Blob) {
    return true;
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  return Object.values(value).some(containsBlob);
}

describe('binary fields stay out of IndexedDB Blobs (WebKit UnknownError workaround)', () => {
  it('stores screenshot and audio as raw bytes instead of Blob objects, and restores them as Blobs', async () => {
    const stores: Stores = new Map();
    setIndexedDB(fakeIndexedDB(stores));
    await saveDraft('a', doc(12));
    await setDraftScreenshot('a', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }));
    await setDraftAudio('a', {
      blob: new Blob([new Uint8Array([4, 5, 6, 7])], { type: 'audio/mpeg' }),
      name: 'Трек',
      author: 'Автор',
      sync: true,
      bytes: 4,
    });
    const raw = stores.get('drafts')!.get('a');
    expect(containsBlob(raw)).toBe(false);

    const [listed] = await listDrafts();
    expect(listed.screenshot).toBeInstanceOf(Blob);
    expect(listed.screenshot!.type).toBe('image/webp');
    expect(new Uint8Array(await listed.screenshot!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(listed.audio!.blob).toBeInstanceOf(Blob);
    expect(listed.audio!.blob.type).toBe('audio/mpeg');
    expect(new Uint8Array(await listed.audio!.blob.arrayBuffer())).toEqual(new Uint8Array([4, 5, 6, 7]));

    const [card] = await listDraftCards();
    expect(card.screenshot).toBeInstanceOf(Blob);
    expect(new Uint8Array(await card.screenshot!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(card.audio).toEqual({ name: 'Трек', author: 'Автор', sync: true, bytes: 4 });
    // Audio bytes live in the separate media store, not inside the `drafts` record,
    // and legacy `record.audio?.blob.size` stays safe (undefined) for older tabs/rollbacks.
    expect((raw as Record<string, unknown>).audio).toBeUndefined();
    expect(stores.get('draft-audio')?.size).toBe(1);

    // Opening a draft loads its audio Blob on demand.
    const opened = await readDraft('a');
    expect(opened?.audio?.blob).toBeInstanceOf(Blob);
    expect(opened?.audio?.blob.type).toBe('audio/mpeg');
    expect(new Uint8Array(await opened!.audio!.blob.arrayBuffer())).toEqual(new Uint8Array([4, 5, 6, 7]));
  });

  it('listDraftCards never reads the audio store, and duplicate/delete keep audio keys isolated', async () => {
    const stores: Stores = new Map();
    setIndexedDB(fakeIndexedDB(stores));
    await saveDraft('a', doc(12));
    await setDraftAudio('a', {
      blob: new Blob([new Uint8Array([10, 20, 30])], { type: 'audio/mpeg' }),
      name: 'Трек',
      author: 'Автор',
      sync: true,
      bytes: 3,
    });

    fakeReads.count = 0;
    const cards = await listDraftCards();
    expect(cards).toHaveLength(1);
    expect(cards[0].audio?.name).toBe('Трек');
    // `listDraftCards` only uses `getAll` on `drafts` — zero point-reads on `draft-audio`.
    expect(fakeReads.count).toBe(0);

    const copy = await duplicateDraft('a');
    expect(copy).not.toBeNull();
    expect(stores.get('draft-audio')?.size).toBe(2);

    await deleteDraft('a');
    expect(stores.get('draft-audio')?.size).toBe(1);
    const openedCopy = await readDraft(copy!);
    expect(new Uint8Array(await openedCopy!.audio!.blob.arrayBuffer())).toEqual(new Uint8Array([10, 20, 30]));
  });

  it('legacy Blob migration does not resurrect a record deleted by another tab or overwrite a newer edit', async () => {
    const stores: Stores = new Map();
    setIndexedDB(fakeIndexedDB(stores));
    await saveDraft('gone', doc(1));
    const drafts = stores.get('drafts')!;

    let releaseDelete!: () => void;
    const slowBlob = Object.assign(new Blob([new Uint8Array([1, 2])]), {
      arrayBuffer: () => new Promise<ArrayBuffer>((resolve) => {
        releaseDelete = () => resolve(new Uint8Array([1, 2]).buffer);
      }),
    });
    drafts.set('gone', { ...(drafts.get('gone') as object), updated: 10, screenshot: slowBlob });

    // Fresh tab: no cached `known` entry.
    setIndexedDB(fakeIndexedDB(stores));
    const pendingShot = setDraftScreenshot('gone', new Blob([new Uint8Array([3, 4])], { type: 'image/webp' }));
    await Bun.sleep(5);
    // Another tab deletes the draft while migration is reading the legacy Blob.
    drafts.delete('gone');
    releaseDelete();
    await pendingShot;
    expect(drafts.has('gone')).toBe(false);

    // Now test concurrent edit during migration: another tab updates the document while
    // `setDraftCredits` is migrating the legacy audio Blob.
    let releaseEdit!: () => void;
    const slowAudio = Object.assign(new Blob([new Uint8Array([5, 6])], { type: 'audio/mpeg' }), {
      arrayBuffer: () => new Promise<ArrayBuffer>((resolve) => {
        releaseEdit = () => resolve(new Uint8Array([5, 6]).buffer);
      }),
    });
    await saveDraft('edited', doc(1));
    drafts.set('edited', {
      ...(drafts.get('edited') as object),
      updated: 10,
      audio: { blob: slowAudio, name: 'Старое', author: '', sync: true, bytes: 2 },
    });
    setIndexedDB(fakeIndexedDB(stores));
    const pendingCredits = setDraftCredits('edited', 'Новое', 'Автор', false);
    await Bun.sleep(5);
    // Another tab saves a newer drawing (v2, already migrated without legacy blobs).
    const newerPacked = new TextEncoder().encode(JSON.stringify(packDocument(doc(24))));
    drafts.set('edited', {
      id: 'edited',
      updated: 20,
      packed: newerPacked,
      audioMeta: { key: 'k-new', name: 'Старое', author: '', sync: true, bytes: 2 },
    });
    const media = stores.get('draft-audio') ?? new Map();
    stores.set('draft-audio', media);
    media.set('k-new', { id: 'k-new', data: new Uint8Array([5, 6]), type: 'audio/mpeg' });
    releaseEdit();
    await pendingCredits;

    const restored = await readDraft('edited');
    expect(restored?.doc).toEqual(doc(24));
    expect(restored?.audio?.name).toBe('Новое');
  });

  it('migrates legacy Blob screenshot and audio when saving over an older record, and drops unreadable ones', async () => {
    const stores: Stores = new Map();
    setIndexedDB(fakeIndexedDB(stores));
    await saveDraft('legacy', doc(1));
    const drafts = stores.get('drafts')!;
    drafts.set('legacy', {
      ...(drafts.get('legacy') as object),
      screenshot: new Blob([new Uint8Array([9, 8])], { type: 'image/png' }),
      audio: { blob: new Blob([new Uint8Array([7, 6])], { type: 'audio/ogg' }), name: 'Старый', author: '' },
    });
    // Simulate a fresh tab that has not cached the record yet.
    setIndexedDB(fakeIndexedDB(stores));
    expect((await saveDraft('legacy', doc(2))).ok).toBe(true);
    expect(containsBlob(stores.get('drafts')!.get('legacy'))).toBe(false);
    const [restored] = await listDrafts(['legacy']);
    expect(restored.doc).toEqual(doc(2));
    expect(new Uint8Array(await restored.screenshot!.arrayBuffer())).toEqual(new Uint8Array([9, 8]));
    expect(new Uint8Array(await restored.audio!.blob.arrayBuffer())).toEqual(new Uint8Array([7, 6]));

    // A lost Safari Blob on disk must not block saving the drawing itself.
    const lost = Object.assign(new Blob(['x']), {
      arrayBuffer: () => Promise.reject(new DOMException('File not found', 'NotReadableError')),
    });
    drafts.set('broken-blob', {
      id: 'broken-blob',
      updated: 1,
      doc: doc(1),
      screenshot: lost,
      audio: { blob: lost, name: 'Пропал', author: '' },
    });
    setIndexedDB(fakeIndexedDB(stores));
    const warn = mock(() => {});
    const original = console.warn;
    console.warn = warn;
    try {
      expect((await saveDraft('broken-blob', doc(3))).ok).toBe(true);
    } finally {
      console.warn = original;
    }
    expect(containsBlob(stores.get('drafts')!.get('broken-blob'))).toBe(false);
    const [saved] = await listDrafts(['broken-blob']);
    expect(saved.doc).toEqual(doc(3));
    expect(saved.screenshot).toBeUndefined();
    expect(saved.audio).toBeUndefined();
  });
});

describe('transient WebKit UnknownError reconnects and retries once', () => {
  it('reopens the database and retries when a transaction fails asynchronously with UnknownError', async () => {
    const stores: Stores = new Map();
    const inner = fakeIndexedDB(stores) as { open(): FakeReq };
    let opens = 0;
    let closed = 0;
    let failNextPut = false;
    setIndexedDB({
      open() {
        const req = inner.open();
        opens++;
        const db = req.result as {
          transaction(): { onerror: ((e: unknown) => void) | null; onabort: (() => void) | null; error: unknown; objectStore(n: string): { put: (...args: unknown[]) => unknown } };
          close(): void;
        };
        const origTx = db.transaction.bind(db);
        const origClose = db.close.bind(db);
        db.close = () => {
          closed++;
          origClose();
        };
        db.transaction = () => {
          const tx = origTx();
          if (failNextPut) {
            failNextPut = false;
            const origStore = tx.objectStore.bind(tx);
            tx.objectStore = (n: string) => {
              const s = origStore(n);
              s.put = () => {
                const err = new DOMException('Connection to Indexed Database server lost.', 'UnknownError');
                queueMicrotask(() => {
                  tx.error = err;
                  tx.onerror?.({ target: { error: err } });
                  tx.onabort?.();
                });
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

    const heard: unknown[] = [];
    const stop = onDraftFailure((operation, cause) => heard.push([operation, cause]));
    try {
      expect((await saveDraft('a', doc(1))).ok).toBe(true);
      expect(opens).toBe(1);
      failNextPut = true;
      const retried = await saveDraft('a', doc(2));
      expect(retried.ok).toBe(true);
      expect(opens).toBe(2);
      expect(closed).toBe(1);
      expect(heard).toEqual([]);
      expect((await listDrafts())[0].doc).toEqual(doc(2));
    } finally {
      stop();
    }
  });

  it('retries indexedDB.open once on UnknownError and reports only if both attempts fail', async () => {
    const stores: Stores = new Map();
    const inner = fakeIndexedDB(stores) as { open(): FakeReq };
    let openAttempts = 0;
    let failOpens = 1;
    setIndexedDB({
      open() {
        openAttempts++;
        if (openAttempts <= failOpens) {
          const req = new FakeReq();
          req.error = new DOMException('Internal error opening backing store for indexedDB.open.', 'UnknownError');
          queueMicrotask(() => req.onerror?.());
          return req;
        }
        return inner.open();
      },
    });
    const heard: unknown[] = [];
    const stop = onDraftFailure((operation, cause) => heard.push([operation, cause]));
    try {
      const recovered = await saveDraft('a', doc(1));
      expect(recovered.ok).toBe(true);
      expect(recovered.bytes).toBeGreaterThan(0);
      expect(openAttempts).toBe(2);
      expect(heard).toEqual([]);
    } finally {
      stop();
    }

    // Persistent open failure still reports once after retrying.
    openAttempts = 0;
    failOpens = 10;
    const persistentHeard: unknown[] = [];
    const stop2 = onDraftFailure((operation, cause) => persistentHeard.push([operation, cause]));
    const warn = mock(() => {});
    const original = console.warn;
    console.warn = warn;
    setIndexedDB({
      open() {
        openAttempts++;
        const req = new FakeReq();
        req.error = new DOMException('Internal error opening backing store for indexedDB.open.', 'UnknownError');
        queueMicrotask(() => req.onerror?.());
        return req;
      },
    });
    try {
      await saveDraft('b', doc(1));
      expect(openAttempts).toBe(2);
      expect(persistentHeard).toEqual([['draft save', 'UnknownError']]);
    } finally {
      stop2();
      console.warn = original;
    }
  });

  it('returns failure (not ok:true) and null duplicate ID when reopen fails after a failed write', async () => {
    const stores: Stores = new Map();
    const inner = fakeIndexedDB(stores) as { open(): FakeReq };
    let failWritesAndReopens = false;
    setIndexedDB({
      open() {
        if (failWritesAndReopens) {
          const req = new FakeReq();
          req.error = new DOMException('Internal error opening backing store.', 'UnknownError');
          queueMicrotask(() => req.onerror?.());
          return req;
        }
        const req = inner.open();
        const db = req.result as {
          transaction(): { onerror: ((e: unknown) => void) | null; onabort: (() => void) | null; error: unknown; objectStore(n: string): { put: (...args: unknown[]) => unknown } };
          close(): void;
        };
        const origTx = db.transaction.bind(db);
        db.transaction = () => {
          const tx = origTx();
          const origStore = tx.objectStore.bind(tx);
          tx.objectStore = (n: string) => {
            const s = origStore(n);
            const origPut = s.put.bind(s);
            s.put = (...args: unknown[]) => {
              if (failWritesAndReopens) {
                const err = new DOMException('Connection to Indexed Database server lost.', 'UnknownError');
                queueMicrotask(() => {
                  tx.error = err;
                  tx.onerror?.({ target: { error: err } });
                  tx.onabort?.();
                });
                return new FakeReq();
              }
              return origPut(...args);
            };
            return s;
          };
          return tx;
        };
        return req;
      },
    });

    const warn = mock(() => {});
    const original = console.warn;
    console.warn = warn;
    const heard: unknown[] = [];
    const stop = onDraftFailure((operation, cause, detail) => heard.push({ operation, cause, detail }));
    try {
      expect((await saveDraft('a', doc(1))).ok).toBe(true);
      // Now the active connection dies on put AND subsequent opens also fail.
      failWritesAndReopens = true;
      expect(await saveDraft('a', doc(2))).toEqual({ ok: false, bytes: 0 });
      expect(heard).toEqual([{
        operation: 'draft save',
        cause: 'UnknownError',
        detail: { stage: 'open', reason: 'backing_store', retried: true },
      }]);
    } finally {
      stop();
      console.warn = original;
    }

    // Same for duplicateDraft: if the write fails and reopen fails, duplicateDraft must return null.
    let failSecondPutAndOpen = false;
    let putCount = 0;
    const stores2: Stores = new Map();
    const inner2 = fakeIndexedDB(stores2) as { open(): FakeReq };
    setIndexedDB({
      open() {
        if (failSecondPutAndOpen) {
          const req = new FakeReq();
          req.error = new DOMException('Internal error opening backing store.', 'UnknownError');
          queueMicrotask(() => req.onerror?.());
          return req;
        }
        const req = inner2.open();
        const db = req.result as {
          transaction(): { onerror: ((e: unknown) => void) | null; onabort: (() => void) | null; error: unknown; objectStore(n: string): { put: (...args: unknown[]) => unknown } };
          close(): void;
        };
        const origTx = db.transaction.bind(db);
        db.transaction = () => {
          const tx = origTx();
          const origStore = tx.objectStore.bind(tx);
          tx.objectStore = (n: string) => {
            const s = origStore(n);
            const origPut = s.put.bind(s);
            s.put = (...args: unknown[]) => {
              putCount++;
              if (putCount >= 2) {
                failSecondPutAndOpen = true;
                const err = new DOMException('Connection to Indexed Database server lost.', 'UnknownError');
                queueMicrotask(() => {
                  tx.error = err;
                  tx.onerror?.({ target: { error: err } });
                  tx.onabort?.();
                });
                return new FakeReq();
              }
              return origPut(...args);
            };
            return s;
          };
          return tx;
        };
        return req;
      },
    });
    console.warn = warn;
    try {
      expect((await saveDraft('orig', doc(1))).ok).toBe(true);
      expect(await duplicateDraft('orig')).toBeNull();
    } finally {
      console.warn = original;
    }
  });
});

describe('draft failure diagnostics report stage, retried flag, and allowlisted reason without raw text', () => {
  it('reports stage=open, reason=backing_store, retried=true when indexedDB.open keeps failing with UnknownError', async () => {
    const heard: unknown[] = [];
    const stop = onDraftFailure((operation, cause, detail) => heard.push({ operation, cause, detail }));
    const warn = mock(() => {});
    const original = console.warn;
    console.warn = warn;
    try {
      // Clear any previous 'draft save' failure episode before testing this one.
      setIndexedDB(fakeIndexedDB());
      await saveDraft('reset', doc(1));

      setIndexedDB({
        open() {
          const req = new FakeReq();
          req.error = new DOMException('Internal error opening backing store for indexedDB.open.', 'UnknownError');
          queueMicrotask(() => req.onerror?.());
          return req;
        },
      });
      await saveDraft('a', doc(1));
      expect(heard).toEqual([{
        operation: 'draft save',
        cause: 'UnknownError',
        detail: { stage: 'open', reason: 'backing_store', retried: true },
      }]);
    } finally {
      stop();
      console.warn = original;
    }
  });

  it('reports stage=put and reason=connection_lost when put keeps failing with UnknownError, and omits unknown messages', async () => {
    const makeFailingDb = (message: string) => ({
      open() {
        const req = new FakeReq();
        req.result = {
          objectStoreNames: { contains: () => true },
          transaction: () => {
            const tx: Record<string, unknown> = {
              objectStore: () => ({
                get: () => {
                  const r = new FakeReq();
                  queueMicrotask(() => r.onsuccess?.());
                  return r;
                },
                put: () => {
                  const err = new DOMException(message, 'UnknownError');
                  queueMicrotask(() => {
                    tx.error = err;
                    (tx.onerror as (e: unknown) => void)({ target: { error: err } });
                    (tx.onabort as () => void)();
                  });
                  return new FakeReq();
                },
              }),
              oncomplete: null,
              onerror: null,
              onabort: null,
              error: null,
            };
            return tx;
          },
          close() {},
        };
        queueMicrotask(() => req.onsuccess?.());
        return req;
      },
    });

    const heard: unknown[] = [];
    const stop = onDraftFailure((operation, cause, detail) => heard.push({ operation, cause, detail }));
    const warn = mock(() => {});
    const original = console.warn;
    console.warn = warn;
    try {
      // Reset any prior failure episode on 'draft save'.
      setIndexedDB(fakeIndexedDB());
      await saveDraft('reset', doc(1));

      setIndexedDB(makeFailingDb('Connection to Indexed Database server lost. Refresh the page to try again'));
      expect((await saveDraft('a', doc(1))).ok).toBe(false);

      // Clear episode with a successful write before testing an unrecognized private message.
      setIndexedDB(fakeIndexedDB());
      await saveDraft('reset', doc(2));

      setIndexedDB(makeFailingDb('secret /Users/alice/private.sqlite failure'));
      expect((await saveDraft('b', doc(1))).ok).toBe(false);

      expect(heard).toEqual([
        {
          operation: 'draft save',
          cause: 'UnknownError',
          detail: { stage: 'put', reason: 'connection_lost', retried: true },
        },
        {
          operation: 'draft save',
          cause: 'UnknownError',
          detail: { stage: 'put', retried: true },
        },
      ]);
    } finally {
      stop();
      console.warn = original;
    }
  });
});

describe('transient AbortError recovery and hidden-tab screenshot aborts', () => {
  it('retries once with a fresh connection when a screenshot transaction aborts with AbortError and reports nothing if the retry succeeds', async () => {
    const stores: Stores = new Map();
    const inner = fakeIndexedDB(stores) as { open(): FakeReq };
    let opens = 0;
    let closed = 0;
    let abortNextPut = false;
    setIndexedDB({
      open() {
        opens++;
        const req = inner.open();
        const db = req.result as {
          transaction(): { onerror: ((e: unknown) => void) | null; onabort: (() => void) | null; error: unknown; objectStore(n: string): { put: (...args: unknown[]) => unknown } };
          close(): void;
        };
        const origClose = db.close.bind(db);
        db.close = () => {
          closed++;
          origClose();
        };
        const origTx = db.transaction.bind(db);
        db.transaction = () => {
          const tx = origTx();
          if (abortNextPut) {
            abortNextPut = false;
            const origStore = tx.objectStore.bind(tx);
            tx.objectStore = (n: string) => {
              const s = origStore(n);
              s.put = () => {
                queueMicrotask(() => {
                  tx.error = null;
                  tx.onabort?.();
                });
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

    const heard: unknown[] = [];
    const stop = onDraftFailure((operation, cause, detail) => heard.push({ operation, cause, detail }));
    try {
      expect((await saveDraft('a', doc(1))).ok).toBe(true);
      expect(opens).toBe(1);
      abortNextPut = true;
      await setDraftScreenshot('a', new Blob([new Uint8Array([4, 5, 6])], { type: 'image/webp' }));
      expect(opens).toBe(2);
      expect(closed).toBe(1);
      expect(heard).toEqual([]);
      const cards = await listDraftCards();
      expect(cards[0].screenshot).toBeInstanceOf(Blob);
      expect(new Uint8Array(await cards[0].screenshot!.arrayBuffer())).toEqual(new Uint8Array([4, 5, 6]));
    } finally {
      stop();
    }
  });

  it('skips screenshot writes while hidden, suppresses mid-hide AbortError without retrying, and still reports visible persistent AbortError', async () => {
    const originalDoc = globalThis.document;
    const fakeDoc = { hidden: false };
    Object.defineProperty(globalThis, 'document', { value: fakeDoc, configurable: true, writable: true });

    const warn = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warn;

    const heard: unknown[] = [];
    const stop = onDraftFailure((operation, cause, detail) => heard.push({ operation, cause, detail }));

    try {
      const stores: Stores = new Map();
      const inner = fakeIndexedDB(stores) as { open(): FakeReq };
      let opens = 0;
      let txCount = 0;
      let hideAndAbortPut = false;
      let alwaysAbortPut = false;
      setIndexedDB({
        open() {
          opens++;
          const req = inner.open();
          const db = req.result as {
            transaction(): { onerror: ((e: unknown) => void) | null; onabort: (() => void) | null; error: unknown; objectStore(n: string): { put: (...args: unknown[]) => unknown } };
            close(): void;
          };
          const origTx = db.transaction.bind(db);
          db.transaction = () => {
            txCount++;
            const tx = origTx();
            if (hideAndAbortPut || alwaysAbortPut) {
              const origStore = tx.objectStore.bind(tx);
              tx.objectStore = (n: string) => {
                const s = origStore(n);
                s.put = () => {
                  queueMicrotask(() => {
                    if (hideAndAbortPut) {
                      fakeDoc.hidden = true;
                    }
                    tx.error = null;
                    tx.onabort?.();
                  });
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

      expect((await saveDraft('a', doc(1))).ok).toBe(true);
      expect(opens).toBe(1);
      const txBeforeHidden = txCount;

      // Case A: page already hidden before screenshot write starts — skips IndexedDB completely.
      fakeDoc.hidden = true;
      await setDraftScreenshot('a', new Blob([new Uint8Array([1])], { type: 'image/webp' }));
      expect(txCount).toBe(txBeforeHidden);
      expect(heard).toEqual([]);

      // Case B: page hides while screenshot transaction is in flight and Safari aborts it.
      fakeDoc.hidden = false;
      hideAndAbortPut = true;
      await setDraftScreenshot('a', new Blob([new Uint8Array([2])], { type: 'image/webp' }));
      hideAndAbortPut = false;
      expect(opens).toBe(1); // did not retry while hidden
      expect(heard).toEqual([]);

      // Case C: page is visible and AbortError persists across the retry — must still report.
      fakeDoc.hidden = false;
      alwaysAbortPut = true;
      const opensBeforePersistent = opens;
      await setDraftScreenshot('a', new Blob([new Uint8Array([3])], { type: 'image/webp' }));
      expect(opens).toBe(opensBeforePersistent + 2); // fresh open after hidden-abort reset + 1 retry
      expect(heard).toEqual([{
        operation: 'draft screenshot save',
        cause: 'AbortError',
        detail: { stage: 'abort', retried: true },
      }]);
    } finally {
      stop();
      console.warn = originalWarn;
      if (originalDoc === undefined) {
        delete (globalThis as { document?: Document }).document;
      } else {
        Object.defineProperty(globalThis, 'document', { value: originalDoc, configurable: true, writable: true });
      }
    }
  });

  it('skips starting a screenshot transaction if the page hides while IndexedDB is opening or reopening for retry', async () => {
    const originalDoc = globalThis.document;
    const fakeDoc = { hidden: false };
    Object.defineProperty(globalThis, 'document', { value: fakeDoc, configurable: true, writable: true });

    const warn = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warn;

    const heard: unknown[] = [];
    const stop = onDraftFailure((operation, cause, detail) => heard.push({ operation, cause, detail }));

    try {
      const stores: Stores = new Map();
      const inner = fakeIndexedDB(stores) as { open(): FakeReq };
      let openCount = 0;
      let txCount = 0;
      let hideDuringOpen = false;
      let abortFirstPutThenHideOnReopen = false;

      setIndexedDB({
        open() {
          openCount++;
          const currentOpen = openCount;
          const innerReq = inner.open();
          const db = innerReq.result as {
            transaction(): { onerror: ((e: unknown) => void) | null; onabort: (() => void) | null; error: unknown; objectStore(n: string): { put: (...args: unknown[]) => unknown } };
            close(): void;
          };
          const origTx = db.transaction.bind(db);
          db.transaction = () => {
            txCount++;
            const tx = origTx();
            if (abortFirstPutThenHideOnReopen && currentOpen === 2) {
              const origStore = tx.objectStore.bind(tx);
              tx.objectStore = (n: string) => {
                const s = origStore(n);
                s.put = () => {
                  queueMicrotask(() => {
                    tx.error = null;
                    tx.onabort?.();
                  });
                  return new FakeReq();
                };
                return s;
              };
            }
            return tx;
          };

          const req = new FakeReq();
          req.result = db;
          queueMicrotask(() => {
            if (hideDuringOpen || (abortFirstPutThenHideOnReopen && currentOpen === 3)) {
              fakeDoc.hidden = true;
            }
            req.onsuccess?.();
          });
          return req;
        },
      });

      // Case 1: tab hides while initial open for screenshot save is in flight.
      fakeDoc.hidden = false;
      hideDuringOpen = true;
      await setDraftScreenshot('a', new Blob([new Uint8Array([1])], { type: 'image/webp' }));
      hideDuringOpen = false;
      expect(openCount).toBe(1);
      expect(txCount).toBe(0);
      expect(heard).toEqual([]);

      // Reset connection via a fresh factory and create a draft while visible.
      fakeDoc.hidden = false;
      expect((await saveDraft('a', doc(1))).ok).toBe(true);
      const txBeforeRetry = txCount;

      // Case 2: visible screenshot put aborts, triggering reopen (open #3); tab hides before open #3 resolves.
      // Must NOT start a retry transaction after open #3 resolves.
      openCount = 1; // next open will be #2 (fresh DB) -> abort -> #3 (reopen while hiding)
      setIndexedDB({
        open() {
          openCount++;
          const currentOpen = openCount;
          const innerReq = inner.open();
          const db = innerReq.result as {
            transaction(): { onerror: ((e: unknown) => void) | null; onabort: (() => void) | null; error: unknown; objectStore(n: string): { put: (...args: unknown[]) => unknown } };
            close(): void;
          };
          const origTx = db.transaction.bind(db);
          db.transaction = () => {
            txCount++;
            const tx = origTx();
            if (currentOpen === 2) {
              const origStore = tx.objectStore.bind(tx);
              tx.objectStore = (n: string) => {
                const s = origStore(n);
                s.put = () => {
                  queueMicrotask(() => {
                    tx.error = null;
                    tx.onabort?.();
                  });
                  return new FakeReq();
                };
                return s;
              };
            }
            return tx;
          };
          const req = new FakeReq();
          req.result = db;
          queueMicrotask(() => {
            if (currentOpen === 3) {
              fakeDoc.hidden = true;
            }
            req.onsuccess?.();
          });
          return req;
        },
      });
      abortFirstPutThenHideOnReopen = true;
      await setDraftScreenshot('a', new Blob([new Uint8Array([2])], { type: 'image/webp' }));
      expect(openCount).toBe(3);
      // Only 1 transaction on open #2 (the aborted attempt), 0 transactions on open #3!
      expect(txCount).toBe(txBeforeRetry + 1);
      expect(heard).toEqual([]);
    } finally {
      stop();
      console.warn = originalWarn;
      if (originalDoc === undefined) {
        delete (globalThis as { document?: Document }).document;
      } else {
        Object.defineProperty(globalThis, 'document', { value: originalDoc, configurable: true, writable: true });
      }
    }
  });
});
