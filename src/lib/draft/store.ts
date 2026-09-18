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

/** An mp3/ogg/wav attached to a session, with the credits the reference asks for. */
export interface DraftAudio {
  blob: Blob;
  name: string;
  author: string;
  /**
   * The file's length in bytes as it was attached. Checked again on restore:
   * a track that comes back shorter than it went in was damaged in storage,
   * and silently handing back a few seconds of a three-minute song is the
   * worst way to report that.
   */
  bytes?: number;
}

/** One saved session: the document plus when it was last written. */
export interface DraftRecord {
  id: string;
  updated: number;
  doc: unknown;
  /** Absent on every draft written before tracks existed — no migration needed. */
  audio?: DraftAudio;
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

/**
 * Writes run one at a time. Two read-modify-writes overlapping — the autosave
 * clock and the track effect are independent and neither awaits the other —
 * each read the record before the other's put and the loser's field is gone:
 * a saved document could drop an attached track, or a track could rewind the
 * document. Queueing also keeps one database connection open at a time, so a
 * finished call never closes the connection another is mid-transaction on.
 */
let writes: Promise<unknown> = Promise.resolve();

function queueWrite<T>(run: () => Promise<T>): Promise<T> {
  const next = writes.then(run, run);
  // A failed write must not poison the queue for everything after it.
  writes = next.catch(() => {});
  return next;
}

/**
 * Read-modify-write of one record in a single transaction, so an autosave
 * never drops the track and attaching a track never rewinds the document.
 * `mutate` always returns a record — the put is what completes the
 * transaction. Never throws.
 */
async function updateDraft(
  id: string,
  what: string,
  mutate: (previous: DraftRecord | undefined) => DraftRecord,
): Promise<void> {
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const read = store.get(id);
        read.onsuccess = () => store.put(mutate(read.result as DraftRecord | undefined));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn(`${what} failed:`, err);
  }
}

/** Persists one session (a plain, structured-clone-safe document). Never throws. */
export async function saveDraft(id: string, doc: unknown): Promise<void> {
  await queueWrite(() =>
    updateDraft(id, 'draft save', (previous) => ({ ...previous, id, updated: Date.now(), doc })),
  );
}

/** Attaches, replaces or (with `null`) removes the session's track. Never throws. */
export async function setDraftAudio(id: string, audio: DraftAudio | null): Promise<void> {
  await queueWrite(() =>
    updateDraft(id, 'draft audio save', (previous) => {
      const next: DraftRecord = { ...previous, id, updated: Date.now(), doc: previous?.doc ?? null };
      if (audio) {
        next.audio = audio;
      } else {
        delete next.audio;
      }
      return next;
    }),
  );
}

/** Removes one session. Never throws. */
export async function deleteDraft(id: string): Promise<void> {
  await queueWrite(() => removeDraft(id));
}

async function removeDraft(id: string): Promise<void> {
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

/**
 * Updates only the track's credits. Typing a name must not rewrite the file:
 * a multi-megabyte put per keystroke is how a draft write ends up racing
 * itself. A session with no track has no credits to keep, so this is a no-op.
 * Never throws.
 */
export async function setDraftCredits(id: string, name: string, author: string): Promise<void> {
  await queueWrite(() =>
    updateDraft(id, 'draft credits save', (previous) => {
      const next: DraftRecord = { ...previous, id, updated: Date.now(), doc: previous?.doc ?? null };
      if (next.audio) {
        next.audio = { ...next.audio, name, author };
      }
      return next;
    }),
  );
}

/**
 * Every saved draft as one file — the reference's «экспорт всех сейвов».
 * Tracks stay behind: JSON carries no Blob, and a file of base64 mp3s would
 * be too heavy to hand around.
 */
export async function exportDrafts(): Promise<string> {
  return JSON.stringify((await listDrafts()).map(({ audio: _audio, ...draft }) => draft));
}

/**
 * Reads such a file back. An id already in use is reminted rather than
 * overwritten — an import must never swallow a draft already on the device —
 * and a record that is not a draft is dropped. Never throws.
 */
export async function importDrafts(raw: string): Promise<{ loaded: number }> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { loaded: 0 };
  }
  if (!Array.isArray(data)) {
    return { loaded: 0 };
  }
  const taken = new Set((await listDrafts()).map((d) => d.id));
  let loaded = 0;
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, doc } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || doc == null) continue;
    const fresh = taken.has(id) ? newDraftId() : id;
    taken.add(fresh);
    await saveDraft(fresh, doc);
    loaded++;
  }
  return { loaded };
}
