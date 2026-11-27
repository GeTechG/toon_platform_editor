import type { ReadRasterAsset } from '../format/project';

const DB_NAME = 'toon-editor-raster';
const STORE = 'raster-cels';
const STORAGE_LOCK = 'toonop:raster-storage';
const WORKSPACE_LOCK = 'toonop:raster-workspace:';
const USED = 'toon-editor:raster-files';
const PIN_DB = 'toon-editor-raster-upload-pins';
const PIN_STORE = 'pins';
const PIN_TTL = 48 * 60 * 60 * 1000;

type StoredRaster = { id: string; bytes: ArrayBuffer };
let shared: { factory: IDBFactory; db: Promise<IDBDatabase> } | undefined;
const unsaved = new Map<string, Blob>();
let unsavedBytes = 0;
const UNSAVED_BUDGET = 32 * 1024 * 1024;
const WORKSPACES = Symbol.for('toonop.raster.workspaces');
const realm = globalThis as typeof globalThis & { [WORKSPACES]?: Map<string, () => Iterable<string>> };
const workspaces = realm[WORKSPACES] ??= new Map();

/** Keeps asset commits and the records that refer to them outside a sweep. */
export async function withRasterStorage<T>(work: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  return locks ? await locks.request(STORAGE_LOCK, { mode: 'shared' }, work) : work();
}

/** Publish this workspace's presence before it can acquire raster files. */
export function retainRasterWorkspace(used: () => Iterable<string>): { ready: Promise<void>; release: () => void } {
  const locks = globalThis.navigator?.locks;
  if (!locks) return { ready: Promise.resolve(), release: () => {} };
  const name = WORKSPACE_LOCK + crypto.randomUUID();
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const ready = withRasterStorage(() => new Promise<void>((resolve, reject) => {
    void locks.request(name, async () => {
      workspaces.set(name, used);
      resolve();
      await held;
      workspaces.delete(name);
    }).catch(reject);
  }));
  return { ready, release };
}

/** Returns false while a writer or another workspace prevents a sweep. */
export async function collectRasterAssets(saved: () => Promise<Set<string>>): Promise<boolean> {
  const locks = globalThis.navigator?.locks;
  if (!locks) return true;
  try {
    if (globalThis.localStorage && localStorage.getItem(USED) === null) return true;
  } catch {
    // A browser may disable localStorage but still allow IndexedDB.
  }
  return locks.request(STORAGE_LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) return false;
    const { held } = await locks.query();
    // Another tab's undo/clipboard state is available only in that tab.
    if (held?.some(({ name }) => name?.startsWith(WORKSPACE_LOCK) && !workspaces.has(name))) return false;
    const keep = await saved();
    for (const pin of await rasterPins()) {
      if (pin.until > Date.now()) for (const hash of pin.hashes) keep.add(hash);
      else await unpinRasterUpload(pin.key);
    }
    for (const used of workspaces.values()) {
      for (const hash of used()) keep.add(hash);
    }
    const db = await connection();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new DOMException('Raster sweep aborted', 'AbortError'));
      const keys = store.getAllKeys();
      keys.onsuccess = () => {
        for (const key of keys.result) if (typeof key === 'string' && !keep.has(key)) store.delete(key);
      };
    });
    for (const [hash, blob] of unsaved) {
      if (!keep.has(hash)) {
        unsaved.delete(hash);
        unsavedBytes -= blob.size;
      }
    }
    return true;
  });
}

type RasterPin = { key: string; hashes: readonly string[]; until: number };

async function pinTransaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(PIN_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(PIN_STORE, { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(PIN_STORE, mode);
      const result = run(tx.objectStore(PIN_STORE));
      tx.oncomplete = () => resolve(result.result);
      tx.onabort = () => reject(tx.error ?? new Error('Could not save raster upload references'));
    });
  } finally {
    db.close();
  }
}

function rasterPins(): Promise<RasterPin[]> {
  return pinTransaction('readonly', (store) => store.getAll());
}

export async function pinRasterUpload(key: string, hashes: readonly string[]): Promise<void> {
  await withRasterStorage(async () => {
    await assertRasterAssets(hashes);
    await pinTransaction('readwrite', (store) => store.put({ key, hashes, until: Date.now() + PIN_TTL } satisfies RasterPin));
  });
}

export async function unpinRasterUpload(key: string): Promise<void> {
  await pinTransaction('readwrite', (store) => store.delete(key));
}

function connection(): Promise<IDBDatabase> {
  const factory = globalThis.indexedDB;
  if (!factory) return Promise.reject(new DOMException('IndexedDB unavailable', 'StorageUnavailable'));
  if (shared?.factory === factory) return shared.db;
  const db = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new DOMException('Raster storage is blocked', 'UpgradeBlocked'));
  });
  shared = { factory, db };
  const reset = () => { if (shared?.db === db) shared = undefined; };
  void db.then((opened) => {
    opened.onclose = reset;
    opened.onversionchange = () => { opened.close(); reset(); };
  }, reset);
  return db;
}

export const readRasterAsset: ReadRasterAsset = async (hash) => {
  const pending = unsaved.get(hash);
  if (pending) return pending;
  const db = await connection();
  const record = await new Promise<StoredRaster | undefined>((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(hash);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return record ? new Blob([record.bytes], { type: 'image/webp' }) : undefined;
};

/** If a write fails, the active project can still display and export the stroke. */
export async function keepRasterAsset(hash: string, blob: Blob): Promise<boolean> {
  try {
    await storeRasterAssets(new Map([[hash, blob]]));
    return true;
  } catch (err) {
    if (!unsaved.has(hash)) {
      if (unsavedBytes + blob.size > UNSAVED_BUDGET) throw err;
      unsaved.set(hash, blob);
      unsavedBytes += blob.size;
    }
    return false;
  }
}

export async function flushRasterAssets(hashes: readonly string[]): Promise<void> {
  for (const hash of hashes) {
    const blob = unsaved.get(hash);
    if (blob) await storeRasterAssets(new Map([[hash, blob]]));
  }
}

export async function assertRasterAssets(hashes: readonly string[]): Promise<void> {
  if (!hashes.length) return;
  const db = await connection();
  const store = db.transaction(STORE).objectStore(STORE);
  await Promise.all(hashes.map((hash) => new Promise<void>((resolve, reject) => {
    const request = store.getKey(hash);
    request.onsuccess = () => request.result === hash ? resolve() : reject(new DOMException('Raster image is unavailable', 'NotFoundError'));
    request.onerror = () => reject(request.error);
  })));
}

/** Commit immutable image bytes before the draft can refer to them. Avoid IndexedDB Blob writes in WebKit. */
export async function storeRasterAssets(assets: ReadonlyMap<string, Blob>): Promise<void> {
  if (!assets.size) return;
  await withRasterStorage(() => writeRasterAssets(assets));
}

async function writeRasterAssets(assets: ReadonlyMap<string, Blob>): Promise<void> {
  try { localStorage.setItem(USED, '1'); } catch { /* IndexedDB may still work */ }
  for (const [id, blob] of assets) {
    const bytes = await blob.arrayBuffer();
    const db = await connection();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new DOMException('Raster write aborted', 'AbortError'));
      const store = tx.objectStore(STORE);
      const existing = store.getKey(id);
      existing.onsuccess = () => {
        if (existing.result !== undefined) return;
        try {
          store.put({ id, bytes } satisfies StoredRaster);
        } catch (err) {
          reject(err);
          tx.abort();
        }
      };
    });
    const pending = unsaved.get(id);
    if (pending) {
      unsavedBytes -= pending.size;
      unsaved.delete(id);
    }
  }
}
