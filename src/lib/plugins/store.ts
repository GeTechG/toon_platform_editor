/**
 * Where an installed plugin lives: one IndexedDB database, one record per
 * plugin, the bundle's source among its fields. The code is kept rather than
 * fetched again on every start, so an installed plugin works without the
 * network and an update is a real download rather than a hope about a cache.
 *
 * Its own database, not the drafts' one: there is no reason for a schema
 * change in drawings to drag plugins through a migration, or the other way.
 *
 * Best-effort, like `draft/store.ts` — a blocked or absent store warns and
 * does nothing, and never throws into the editor.
 */

const DB_NAME = 'toonop-plugins';
const STORE = 'plugins';
const VERSION = 1;

export interface InstalledPlugin {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly description: string;
  /** SVG markup for the list; the tool's own icon comes from its module. */
  readonly icon: string;
  /** The bundle, as text — what the editor builds a module out of. */
  readonly code: string;
  /**
   * `local` is a bundle picked from disk: the catalog never updates it.
   * `bundled` is the one the editor ships with: it is never in the store at
   * all, and the list shows it from the register instead.
   */
  readonly source: 'catalog' | 'local' | 'bundled';
  readonly installed: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('another tab holds an older plugin database'));
  });
}

/** Everything installed, by name — the order the list shows them in. */
export async function listInstalled(): Promise<InstalledPlugin[]> {
  try {
    const db = await openDb();
    try {
      const all = await new Promise<InstalledPlugin[]>((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result as InstalledPlugin[]);
        req.onerror = () => reject(req.error);
      });
      return all.sort((a, b) => a.name.localeCompare(b.name));
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn('plugin list failed:', err);
    return [];
  }
}

async function write(what: string, run: (store: IDBObjectStore) => void): Promise<void> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (err) {
    console.warn(`${what} failed:`, err);
    return;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      run(tx.objectStore(STORE));
    });
  } catch (err) {
    console.warn(`${what} failed:`, err);
  } finally {
    db.close();
  }
}

export function putInstalled(plugin: InstalledPlugin): Promise<void> {
  return write('plugin install', (store) => store.put(plugin));
}

export function removeInstalled(id: string): Promise<void> {
  return write('plugin remove', (store) => store.delete(id));
}
