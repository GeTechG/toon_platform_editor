/**
 * Minimal in-memory IndexedDB fake — enough for the keyPath stores the editor
 * keeps (drafts, installed plugins): open → (upgrade with the previous
 * version) → success, readwrite put/delete completing via tx.oncomplete,
 * readonly getAll returning via request.onsuccess.
 */
export class FakeReq {
  result: unknown;
  error: unknown = null;
  transaction: FakeTx | null = null;
  onsuccess: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  onerror: (() => void) | null = null;
}

export type Stores = Map<string, Map<string, unknown>>;

/** Every store the editor keeps is keyed by `id`; the pre-v2 `draft` one was not. */
function keyPathOf(name: string): string | null {
  return name === 'draft' ? null : 'id';
}

class FakeObjectStore {
  constructor(
    private data: Map<string, unknown>,
    private tx: FakeTx,
    private keyPath: string | null,
  ) {}
  get(key: string): FakeReq {
    const req = new FakeReq();
    req.result = this.data.get(key);
    queueMicrotask(() => {
      req.onsuccess?.();
      // A real transaction completes once nothing is left to do — including
      // when the read's handler decides to write nothing at all.
      queueMicrotask(() => this.tx.oncomplete?.());
    });
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
    return new FakeObjectStore(data, this, keyPathOf(name));
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
    return new FakeObjectStore(data, new FakeTx(this.stores), keyPathOf(name));
  }
  transaction(): FakeTx {
    return new FakeTx(this.stores);
  }
  close(): void {}
}

/** A fake whose storage starts at `stores` — used to plant a pre-v2 draft. */
export function fakeIndexedDB(stores: Stores = new Map(), wanted = 2): unknown {
  const state = { version: stores.size > 0 ? 1 : 0, stores };
  return {
    open() {
      const req = new FakeReq();
      req.result = new FakeDb(state.stores);
      queueMicrotask(() => {
        if (state.version < wanted) {
          state.version = wanted;
          req.transaction = new FakeTx(state.stores);
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });
      return req;
    },
  };
}

export function setIndexedDB(value: unknown): void {
  (globalThis as { indexedDB?: unknown }).indexedDB = value;
}
