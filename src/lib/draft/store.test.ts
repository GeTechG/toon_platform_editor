import { afterEach, describe, expect, it, mock } from 'bun:test';
import { loadDraft, saveDraft } from './store';

/**
 * Minimal in-memory IndexedDB fake — just enough for the one-store,
 * one-key wrapper: open → (upgrade) → success, readwrite put completing
 * via tx.oncomplete, readonly get returning via request.onsuccess.
 */
class FakeReq {
  result: unknown;
  error: unknown = null;
  onsuccess: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  onerror: (() => void) | null = null;
}

class FakeObjectStore {
  constructor(
    private data: Map<string, unknown>,
    private tx: FakeTx,
  ) {}
  get(key: string): FakeReq {
    const req = new FakeReq();
    req.result = this.data.get(key);
    queueMicrotask(() => req.onsuccess?.());
    return req;
  }
  put(value: unknown, key: string): FakeReq {
    this.data.set(key, value);
    queueMicrotask(() => this.tx.oncomplete?.());
    return new FakeReq();
  }
}

class FakeTx {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private store: FakeObjectStore;
  constructor(data: Map<string, unknown>) {
    this.store = new FakeObjectStore(data, this);
  }
  objectStore(): FakeObjectStore {
    return this.store;
  }
}

class FakeDb {
  constructor(private data: Map<string, unknown>) {}
  createObjectStore(): void {}
  transaction(): FakeTx {
    return new FakeTx(this.data);
  }
  close(): void {}
}

function fakeIndexedDB(): unknown {
  const data = new Map<string, unknown>();
  return {
    open() {
      const req = new FakeReq();
      req.result = new FakeDb(data);
      queueMicrotask(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

function setIndexedDB(value: unknown): void {
  (globalThis as { indexedDB?: unknown }).indexedDB = value;
}

afterEach(() => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
});

describe('draft store', () => {
  it('round-trips a document through save and load', async () => {
    setIndexedDB(fakeIndexedDB());
    const doc = { schema_version: 1, width: 4800, height: 2400, frame_rate: 12, frames: [{ strokes: [] }] };
    await saveDraft(doc);
    expect(await loadDraft()).toEqual(doc);
  });

  it('returns null when nothing was saved', async () => {
    setIndexedDB(fakeIndexedDB());
    expect(await loadDraft()).toBeNull();
  });

  it('degrades quietly when IndexedDB is unavailable', async () => {
    // No indexedDB global (bun's default) → best-effort no-op, no throw.
    const warn = mock(() => {});
    const original = console.warn;
    console.warn = warn;
    try {
      await expect(saveDraft({ any: true })).resolves.toBeUndefined();
      expect(await loadDraft()).toBeNull();
    } finally {
      console.warn = original;
    }
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
