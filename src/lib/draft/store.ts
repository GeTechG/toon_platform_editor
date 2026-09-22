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
   * Whether the frames are tied to the track (the reference's synchronisation
   * flag, `editor_help.js ShowSoundName`). Absent on tracks saved before the
   * flag existed, which read as tied — that was their behaviour.
   */
  sync?: boolean;
  /**
   * The file's length in bytes as it was attached. Checked again on restore:
   * a track that comes back shorter than it went in was damaged in storage,
   * and silently handing back a few seconds of a three-minute song is the
   * worst way to report that.
   */
  bytes?: number;
}

/**
 * What the editor was doing when the draft was written — restored with it, so
 * reopening a draft puts the hand back where it was. Absent on every record
 * written before this existed; those restore as they always did.
 */
export interface DraftState {
  frame: number;
  layer: number;
  tool: string;
  /** Brush width per tool kind, and the two smoothing knobs beside it. */
  widths: Record<string, number>;
  smooth: Record<string, number>;
  minDistance: Record<string, number>;
  outline: string;
  fill: string;
  palette: string[];
  /** Tag colour per layer, bottom-up; absent on records written before tags were pickable. */
  layerColors?: number[];
}

/** One saved session: the document plus when it was last written. */
export interface DraftRecord {
  id: string;
  updated: number;
  doc: unknown;
  /** Absent on every draft written before tracks existed — no migration needed. */
  audio?: DraftAudio;
  state?: DraftState;
  /** WebP of the first frame — the card's thumbnail without re-rendering it. */
  screenshot?: Blob;
  /** Size of the record as last written, so the list never weighs it again. */
  bytes?: number;
}

/** What the track and the screenshot add to a record. */
function blobBytes(record: DraftRecord): number {
  return (record.audio?.blob.size ?? 0) + (record.screenshot?.size ?? 0);
}

/**
 * What the record weighs: document text, track and screenshot. A write that
 * kept the document it read — the screenshot, the track, its credits — carries
 * the document's share over from the size already stored instead of walking
 * every stroke again to learn a number it has.
 */
function recordBytes(record: DraftRecord, previous: DraftRecord | undefined): number {
  if (previous && record.doc === previous.doc && previous.bytes !== undefined) {
    return previous.bytes - blobBytes(previous) + blobBytes(record);
  }
  let bytes = 0;
  try {
    bytes += JSON.stringify(record.doc ?? null).length;
  } catch {
    // A document that will not stringify is not one we can size.
  }
  return bytes + blobBytes(record);
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
 * One connection for the page, opened on first use and kept: opening and
 * closing the database around every autosave was a round trip per write for
 * nothing. It is given up only when another tab needs to upgrade the schema,
 * or when opening failed — the next call tries again. Keyed by the factory, so
 * a page (or a test) that swaps `indexedDB` never writes into the old one.
 */
let shared: { factory: unknown; db: Promise<IDBDatabase> } | null = null;

function connection(): Promise<IDBDatabase> {
  const factory = typeof indexedDB === 'undefined' ? undefined : indexedDB;
  if (shared && shared.factory === factory) {
    return shared.db;
  }
  const db = openDb().then((opened) => {
    opened.onversionchange = () => {
      opened.close();
      shared = null;
    };
    return opened;
  });
  db.catch(() => {
    if (shared?.db === db) {
      shared = null;
    }
  });
  shared = { factory, db };
  return db;
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
    const db = await connection();
    const all = await new Promise<DraftRecord[]>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as DraftRecord[]);
      req.onerror = () => reject(req.error);
    });
    return all.sort((a, b) => b.updated - a.updated);
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
 * document.
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
 * `mutate` returning null writes nothing — that is how a side write (the
 * screenshot, the track, its credits) declines to resurrect a record that was
 * deleted while it was in flight. Never throws; `false` means the write into
 * working storage failed (a full quota), which is the only case worth telling
 * anyone about — having no IndexedDB at all is a quiet degradation and reads
 * as `true`.
 */
async function updateDraft(
  id: string,
  what: string,
  mutate: (previous: DraftRecord | undefined) => DraftRecord | null,
  /** What the record turned out to weigh — the write already knows. */
  wrote?: (bytes: number) => void,
): Promise<boolean> {
  let db: IDBDatabase;
  try {
    db = await connection();
  } catch (err) {
    console.warn(`${what} failed:`, err);
    return true;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const read = store.get(id);
      read.onsuccess = () => {
        const previous = read.result as DraftRecord | undefined;
        const next = mutate(previous);
        if (!next) {
          return; // nothing to write; the transaction completes on its own
        }
        next.bytes = recordBytes(next, previous);
        wrote?.(next.bytes);
        store.put(next);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch (err) {
    console.warn(`${what} failed:`, err);
    return false;
  }
}

/** What one draft write did: whether it landed, and what the record weighs. */
export interface DraftWrite {
  ok: boolean;
  /** Size of the record as written; 0 when nothing was written. */
  bytes: number;
}

/**
 * Persists one session (a plain, structured-clone-safe document) and what the
 * editor was doing at the time. Never throws; see `updateDraft` for what `ok`
 * means.
 *
 * The size comes back with the answer because the write already serialized the
 * document to size the record: asking the caller to stringify it again is a
 * second full pass over every stroke of the drawing, on the main thread, for
 * an indicator.
 */
export async function saveDraft(id: string, doc: unknown, state?: DraftState): Promise<DraftWrite> {
  let bytes = 0;
  const ok = await queueWrite(() =>
    updateDraft(id, 'draft save', (previous) => {
      const next: DraftRecord = { ...previous, id, updated: Date.now(), doc };
      if (state) {
        next.state = state;
      }
      return next;
    }, (written) => {
      bytes = written;
    }),
  );
  return { ok, bytes };
}

/**
 * Stores the card's thumbnail on its own — it is rendered when the CPU is
 * idle, which can be after the draft was deleted. A record that is no longer
 * there is not recreated for the sake of a picture of it.
 */
export async function setDraftScreenshot(id: string, screenshot: Blob): Promise<void> {
  await queueWrite(() =>
    updateDraft(id, 'draft screenshot save', (previous) =>
      previous ? { ...previous, screenshot } : null,
    ),
  );
}

/** Copies a draft under a fresh id; returns it, or null when there was nothing to copy. */
export async function duplicateDraft(id: string): Promise<string | null> {
  const source = (await listDrafts()).find((draft) => draft.id === id);
  if (!source) {
    return null;
  }
  const copy = newDraftId();
  await queueWrite(() => updateDraft(copy, 'draft duplicate', () => ({ ...source, id: copy, updated: Date.now() })));
  return copy;
}

/** Empties the list. Never throws. */
export async function deleteAllDrafts(): Promise<void> {
  for (const draft of await listDrafts()) {
    await deleteDraft(draft.id);
  }
}

/** Attaches, replaces or (with `null`) removes the session's track. Never throws. */
export async function setDraftAudio(id: string, audio: DraftAudio | null): Promise<void> {
  await queueWrite(() =>
    updateDraft(id, 'draft audio save', (previous) => {
      if (!previous) {
        // Nothing drawn yet, or the record is gone: a track alone is not a draft.
        return null;
      }
      const next: DraftRecord = { ...previous, id, updated: Date.now() };
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
    const db = await connection();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('draft delete failed:', err);
  }
}

/**
 * Updates the track's credits and its synchronisation flag — everything about
 * a track except the file. Typing a name must not rewrite that file: a
 * multi-megabyte put per keystroke is how a draft write ends up racing itself.
 * A session with no track has nothing to keep, so this is a no-op. Never throws.
 */
export async function setDraftCredits(
  id: string,
  name: string,
  author: string,
  sync: boolean,
): Promise<void> {
  await queueWrite(() =>
    updateDraft(id, 'draft credits save', (previous) => {
      if (!previous?.audio) {
        return null; // no record, or no track on it — nothing to name
      }
      return { ...previous, id, updated: Date.now(), audio: { ...previous.audio, name, author, sync } };
    }),
  );
}

/** One record inside a `.toonops` file: blobs as base64, the document as text. */
export interface DraftSave {
  id: string;
  updated: number;
  /** The document, JSON-encoded — the reference's `data` field. */
  data: string;
  state?: DraftState;
  screenshot?: string;
  audio?: string;
  audioType?: string;
  audioName?: string;
  audioAuthor?: string;
  audioSync?: boolean;
}

/** Base64 of a blob, in chunks — `btoa(...bytes)` blows the stack on a song. */
async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let at = 0; at < bytes.length; at += 8192) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  }
  return btoa(binary);
}

function fromBase64(text: string, type: string): Blob {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type });
}

/**
 * The chosen drafts as one `.toonops` file — our own name for the reference's
 * «экспорт сейвов» shape (`{version, saves}`), so a `.toonio` exported from
 * toonio.ru still opens here. Blobs travel base64-encoded, so a track moves to
 * another device with the drawing it belongs to. No ids — every draft.
 */
export async function exportDrafts(
  ids?: readonly string[],
  onProgress?: (done: number, total: number) => void,
): Promise<string> {
  const chosen = (await listDrafts()).filter((draft) => !ids || ids.includes(draft.id));
  const saves: DraftSave[] = [];
  for (const draft of chosen) {
    const save: DraftSave = {
      id: draft.id,
      updated: draft.updated,
      data: JSON.stringify(draft.doc),
      ...(draft.state ? { state: draft.state } : {}),
    };
    if (draft.screenshot) {
      save.screenshot = await toBase64(draft.screenshot);
    }
    if (draft.audio) {
      save.audio = await toBase64(draft.audio.blob);
      save.audioType = draft.audio.blob.type;
      save.audioName = draft.audio.name;
      save.audioAuthor = draft.audio.author;
      save.audioSync = draft.audio.sync ?? true;
    }
    saves.push(save);
    onProgress?.(saves.length, chosen.length);
  }
  return JSON.stringify({ version: 1, saves });
}

/**
 * Reads such a file back — ours, toonio.ru's `.toonio`, and the plain array
 * the editor used to write. An id
 * already in use is reminted rather than overwritten — an import must never
 * swallow a draft already on the device — and a record that will not read is
 * counted as broken instead of stopping the rest. Never throws.
 */
export async function importDrafts(raw: string): Promise<{ loaded: number; broken: number }> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { loaded: 0, broken: 0 };
  }
  const entries = Array.isArray(data) ? data : (data as { saves?: unknown })?.saves;
  if (!Array.isArray(entries)) {
    return { loaded: 0, broken: 0 };
  }
  const taken = new Set((await listDrafts()).map((d) => d.id));
  let loaded = 0;
  let broken = 0;
  for (const entry of entries) {
    const record = readSave(entry);
    if (!record) {
      broken++;
      continue;
    }
    const fresh = taken.has(record.id) ? newDraftId() : record.id;
    taken.add(fresh);
    await queueWrite(() =>
      updateDraft(fresh, 'draft import', () => ({ ...record, id: fresh })),
    );
    loaded++;
  }
  return { loaded, broken };
}

/** One entry of either file shape as a record, or null when it is not one. */
function readSave(entry: unknown): DraftRecord | null {
  if (typeof entry !== 'object' || entry === null) {
    return null;
  }
  const save = entry as Record<string, unknown>;
  if (typeof save.id !== 'string') {
    return null;
  }
  let doc = save.doc;
  if (typeof save.data === 'string') {
    try {
      doc = JSON.parse(save.data);
    } catch {
      return null;
    }
  }
  if (doc == null) {
    return null;
  }
  const record: DraftRecord = {
    id: save.id,
    updated: typeof save.updated === 'number' ? save.updated : Date.now(),
    doc,
  };
  if (save.state && typeof save.state === 'object') {
    record.state = save.state as DraftState;
  }
  try {
    if (typeof save.screenshot === 'string') {
      record.screenshot = fromBase64(save.screenshot, 'image/webp');
    }
    if (typeof save.audio === 'string') {
      const blob = fromBase64(save.audio, typeof save.audioType === 'string' ? save.audioType : 'audio/mpeg');
      record.audio = {
        blob,
        name: typeof save.audioName === 'string' ? save.audioName : '',
        author: typeof save.audioAuthor === 'string' ? save.audioAuthor : '',
        sync: save.audioSync !== false,
        bytes: blob.size,
      };
    }
  } catch {
    return null; // base64 that is not base64
  }
  return record;
}
