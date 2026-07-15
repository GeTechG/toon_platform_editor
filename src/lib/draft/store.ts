/**
 * Local draft persistence: one IndexedDB database, one object store, one
 * fixed key. Best-effort — every failure (private mode, blocked storage,
 * no IndexedDB) degrades to a no-op with a console.warn and never throws
 * to the caller, so drawing is never interrupted by storage.
 */

const DB_NAME = 'toon-editor';
const STORE = 'draft';
const KEY = 'current';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Returns the stored draft (raw JSON), or null if none / on any failure. */
export async function loadDraft(): Promise<unknown | null> {
  try {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn('draft load failed:', err);
    return null;
  }
}

/** Persists the draft (a plain, structured-clone-safe document). Never throws. */
export async function saveDraft(doc: unknown): Promise<void> {
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(doc, KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn('draft save failed:', err);
  }
}
