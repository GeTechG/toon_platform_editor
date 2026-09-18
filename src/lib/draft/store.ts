/**
 * Local draft persistence: one IndexedDB database, one object store, one
 * record per session. Best-effort — every failure (private mode, blocked
 * storage, no IndexedDB) degrades to a no-op with a console.warn and never
 * throws to the caller, so drawing is never interrupted by storage.
 */

const DB_NAME = 'toon-editor';
const STORE = 'drafts';
/** Version 1 kept a single draft under one fixed key; carried over on upgrade. */
const LEGACY_STORE = 'draft';
const LEGACY_KEY = 'current';
const VERSION = 2;

/** One saved session: the document plus when it was last written. */
export interface DraftRecord {
  id: string;
  updated: number;
  doc: unknown;
}

/** Id for a fresh session — minted on the first edit, kept until the sheet is left. */
export function newDraftId(): string {
  return crypto.randomUUID();
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(STORE)) {
        return;
      }
      const drafts = db.createObjectStore(STORE, { keyPath: 'id' });
      if (db.objectStoreNames.contains(LEGACY_STORE)) {
        // The single pre-v2 draft becomes the first session. The old store is
        // left in place: a few dead kilobytes cost less than a lost drawing if
        // the upgrade is interrupted halfway.
        const old = req.transaction!.objectStore(LEGACY_STORE).get(LEGACY_KEY);
        old.onsuccess = () => {
          if (old.result != null) {
            drafts.put({ id: newDraftId(), updated: Date.now(), doc: old.result });
          }
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    // Another tab still holds the previous version: the upgrade never runs, so
    // give up instead of leaving the caller's promise pending forever.
    req.onblocked = () => reject(new Error('another tab holds an older draft database'));
  });
}

/**
 * Every saved draft, newest first.
 *
 * ponytail: reads whole documents to build the list — the preview is drawn
 * from the document itself, so there is nothing lighter to read. Add a meta
 * index if someone keeps dozens of heavy drafts.
 */
export async function listDrafts(): Promise<DraftRecord[]> {
  try {
    const db = await openDb();
    try {
      const all = await new Promise<DraftRecord[]>((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result as DraftRecord[]);
        req.onerror = () => reject(req.error);
      });
      return all.sort((a, b) => b.updated - a.updated);
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn('draft list failed:', err);
    return [];
  }
}

/** Persists one session (a plain, structured-clone-safe document). Never throws. */
export async function saveDraft(id: string, doc: unknown): Promise<void> {
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ id, updated: Date.now(), doc });
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

/** Removes one session. Never throws. */
export async function deleteDraft(id: string): Promise<void> {
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn('draft delete failed:', err);
  }
}
