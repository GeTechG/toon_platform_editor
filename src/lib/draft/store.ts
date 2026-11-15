/**
 * Local draft persistence: one IndexedDB database, one object store, one
 * record per session. Best-effort — every failure (private mode, blocked
 * storage, no IndexedDB) degrades to a no-op with a console.warn and never
 * throws to the caller, so drawing is never interrupted by storage.
 */

import { parseDraft } from './restore';
import { decodeToon } from '../format/toon-decode';
import { packDocument, unpackDocument } from '../format/pack';
import type { ToonDocument } from '../format/types';
import { MAX_BRUSH_SIZE_LOGICAL, MIN_BRUSH_SIZE_LOGICAL } from '../format/constants';

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
  /**
   * The document. In the base it is kept as `packed` instead (2026-11-14);
   * records written before that hold it here, and every record read out of the
   * store carries it here, whichever way it was kept.
   */
  doc: unknown;
  /** The document as the UTF-8 bytes of its packed JSON (`pack.ts`), as it lies in the base. */
  packed?: Uint8Array;
  /** Absent on every draft written before tracks existed — no migration needed. */
  audio?: DraftAudio;
  state?: DraftState;
  /** WebP of the first frame — the card's thumbnail without re-rendering it. */
  screenshot?: Blob;
  /** Size of the record as last written, so the list never weighs it again. */
  bytes?: number;
  /**
   * What the card shows of the document, written with it — the list reads this
   * and never the document (2026-11-15). Absent on records written before.
   */
  summary?: DraftSummary;
  /** A record from before the cards whose document did not read: kept, never listed. */
  broken?: true;
}

/** The sheet, the frames and the layers of a draft, as its card shows them. */
export interface DraftSummary {
  width: number;
  height: number;
  frames: number;
  layers: number;
}

/**
 * A draft as the list shows it: no document, except for a card that has no
 * screenshot yet — its first frame is drawn from the document.
 */
export interface DraftCard {
  id: string;
  updated: number;
  summary: DraftSummary;
  audio?: DraftAudio;
  state?: DraftState;
  screenshot?: Blob;
  bytes?: number;
  doc?: ToonDocument;
}

/** What the track and the screenshot add to a record. */
function blobBytes(record: DraftRecord): number {
  return (record.audio?.blob.size ?? 0) + (record.screenshot?.size ?? 0);
}

/**
 * The document as it goes into the base: one array of bytes, the packed JSON
 * of it. A tree of 34 000 strokes was cloned into IndexedDB and out of it
 * object by object, which cost more than the text it makes (a sent file,
 * 2026-11-14). The text is the one serialization a write makes — its length is
 * what the record weighs.
 */
function encodeDoc(doc: unknown): Uint8Array {
  const isDocument = typeof doc === 'object' && doc !== null && Array.isArray((doc as ToonDocument).layers);
  return new TextEncoder().encode(JSON.stringify(isDocument ? packDocument(doc as ToonDocument) : doc ?? null));
}

/** A record as the rest of the studio reads it: the document in `doc`, however it was kept. */
function opened(record: DraftRecord): DraftRecord {
  if (!record.packed) {
    return record;
  }
  const { packed, ...rest } = record;
  let doc: unknown = null;
  try {
    doc = unpackDocument(JSON.parse(new TextDecoder().decode(packed)));
  } catch {
    // Bytes that do not read: the record lists with no document, as a broken one did.
  }
  return { ...rest, doc };
}

function summarize(doc: unknown): DraftSummary | null {
  if (typeof doc !== 'object' || doc === null || !Array.isArray((doc as ToonDocument).layers)) {
    return null;
  }
  const { width, height, layers } = doc as ToonDocument;
  return { width, height, frames: layers[0]?.frames?.length ?? 0, layers: layers.length };
}

/**
 * Puts the record's document into bytes, if it came as a document — a save,
 * a copy, an import. A write that kept the document it read (the screenshot,
 * the track, its credits) keeps its bytes as they are.
 */
function pack(record: DraftRecord): void {
  if (record.doc !== undefined) {
    const summary = summarize(record.doc);
    if (summary) {
      record.summary = summary;
      delete record.broken;
    }
    record.packed = encodeDoc(record.doc);
    delete (record as Partial<DraftRecord>).doc;
  }
}

/**
 * What the record weighs: the document's bytes, track and screenshot. A write
 * that kept the bytes it read carries their share over instead of weighing
 * them again.
 */
function recordBytes(record: DraftRecord, previous: DraftRecord | undefined): number {
  if (previous && record.packed !== undefined && record.packed === previous.packed && previous.bytes !== undefined) {
    return previous.bytes - blobBytes(previous) + blobBytes(record);
  }
  if (previous && record.packed === undefined && record.doc === previous.doc && previous.bytes !== undefined) {
    return previous.bytes - blobBytes(previous) + blobBytes(record);
  }
  let bytes = record.packed?.length ?? 0;
  if (record.packed === undefined) {
    try {
      bytes += JSON.stringify(record.doc ?? null).length;
    } catch {
      // A document that will not stringify is not one we can size.
    }
  }
  return bytes + blobBytes(record);
}

/**
 * Id for a fresh session — minted on the first edit, kept until the sheet is left.
 * `randomUUID` exists only in a secure context: the studio opened over plain
 * http (a phone on the dev server's LAN address) threw before its first frame.
 * `getRandomValues` is there everywhere and makes the same version-4 id.
 */
export function newDraftId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
  // Another base, or this one dropped under the page: what was known of it is not.
  known.clear();
  const db = openDb().then((opened) => {
    opened.onversionchange = () => {
      opened.close();
      if (shared?.db === db) {
        shared = null;
      }
    };
    // The browser closed it under the page (site data cleared, the disk gone):
    // the next write opens a new one instead of failing on this one for ever.
    opened.onclose = () => {
      if (shared?.db === db) {
        shared = null;
      }
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
 * A transaction on the page's connection. Safari drops the connection of a tab
 * left in the background («Connection to Indexed Database server lost») and
 * says nothing until `transaction()` throws; the connection kept for the page
 * then failed every autosave until a reload. It is given up and opened once
 * more. Null: no storage at all (`connection` refused) — a quiet degradation.
 */
async function transaction(mode: IDBTransactionMode): Promise<IDBTransaction | null> {
  for (let attempt = 0; ; attempt++) {
    const pending = connection();
    let db: IDBDatabase;
    try {
      db = await pending;
    } catch (err) {
      console.warn('draft storage unavailable:', err);
      return null;
    }
    try {
      return db.transaction(STORE, mode);
    } catch (err) {
      if (shared?.db === pending) {
        shared = null;
      }
      if (attempt > 0) {
        throw err;
      }
    }
  }
}

/**
 * Saved drafts with their documents, newest first — every one, or only those
 * of `ids`, read before any document is: an export of two drafts does not read
 * the rest. The list on screen reads `listDraftCards` instead.
 */
export async function listDrafts(ids?: readonly string[]): Promise<DraftRecord[]> {
  try {
    const all = (await rawRecords()).filter((record) => !ids || ids.includes(record.id)).map(opened);
    return all.sort((a, b) => b.updated - a.updated);
  } catch (err) {
    console.warn('draft list failed:', err);
    return [];
  }
}

/** Every record as it lies in the base, the document still in bytes. */
async function rawRecords(): Promise<DraftRecord[]> {
  // After the writes already asked for: a list read around them showed the
  // record from before the save that was just made.
  await writes;
  const tx = await transaction('readonly');
  if (!tx) {
    return [];
  }
  return new Promise<DraftRecord[]>((resolve, reject) => {
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as DraftRecord[]);
    req.onerror = () => reject(req.error);
  });
}

async function rawRecord(id: string): Promise<DraftRecord | undefined> {
  try {
    await writes;
    const tx = await transaction('readonly');
    if (!tx) {
      return undefined;
    }
    return await new Promise<DraftRecord | undefined>((resolve, reject) => {
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result as DraftRecord | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('draft read failed:', err);
    return undefined;
  }
}

/**
 * The drafts as the hub and the settings list them, newest first. A heavy
 * document took about a second to read and check, per draft, on every way
 * into the studio (2026-11-15): the cards are written with the document and
 * read instead. A record from before them is read once here and gets its card
 * (or is marked broken and left out, as the list always dropped one).
 */
export async function listDraftCards(): Promise<DraftCard[]> {
  let records: DraftRecord[];
  try {
    records = await rawRecords();
  } catch (err) {
    console.warn('draft list failed:', err);
    return [];
  }
  const cards: DraftCard[] = [];
  for (const record of records) {
    if (record.broken) {
      continue;
    }
    let doc: ToonDocument | null | undefined;
    let summary = record.summary;
    if (!summary) {
      doc = parseDraft(opened(record).doc, true);
      const found = doc ? summarize(doc) : null;
      void queueWrite(() =>
        updateDraft(record.id, 'draft card', (previous) => {
          if (!previous || previous.summary) {
            return null;
          }
          return found ? { ...previous, summary: found } : { ...previous, broken: true };
        }),
      );
      if (!found) {
        continue;
      }
      summary = found;
    }
    if (!record.screenshot && doc === undefined) {
      doc = parseDraft(opened(record).doc, true);
    }
    const { id, updated, audio, state, screenshot, bytes } = record;
    cards.push({
      id,
      updated,
      summary,
      ...(audio ? { audio } : {}),
      ...(state ? { state } : {}),
      ...(screenshot ? { screenshot } : {}),
      ...(bytes !== undefined ? { bytes } : {}),
      ...(doc && !screenshot ? { doc } : {}),
    });
  }
  return cards.sort((a, b) => b.updated - a.updated);
}

/**
 * The document of one draft, read and checked as any input is — once, when it
 * is opened. Null for a draft that is gone or does not read.
 */
export async function readDraft(id: string): Promise<ToonDocument | null> {
  const record = await rawRecord(id);
  return record ? parseDraft(opened(record).doc, true) : null;
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
 * The records as this tab last wrote or read them, by id. A write takes what it
 * does not change (the track, the screenshot, the credits) from here instead
 * of reading the record back: a read hands back the whole document, and
 * taking it apart cost more than the write itself — 0.7 s a minute on a weak
 * processor for a drawing of 34 000 lines (a sent file, 2026-11-14).
 */
const known = new Map<string, DraftRecord>();

/** Where tabs tell each other which draft they wrote or deleted. */
export const DRAFTS_CHANNEL = 'toonop-drafts';

let channel: BroadcastChannel | null | undefined;
/** The channel, opened once; none where the browser has none. */
function drafts(): BroadcastChannel | null {
  if (channel === undefined) {
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(DRAFTS_CHANNEL);
    if (channel) {
      // Another tab wrote or deleted it: what this one remembers is old.
      channel.onmessage = (event: MessageEvent<{ id?: unknown }>) => {
        if (typeof event.data?.id === 'string') {
          known.delete(event.data.id);
        }
      };
    }
  }
  return channel;
}

/** Tells the other tabs a record changed. */
function told(id: string): void {
  try {
    drafts()?.postMessage({ id });
  } catch {
    // A closed channel: nobody to tell.
  }
}

/**
 * Read-modify-write of one record in a single transaction, so an autosave
 * never drops the track and attaching a track never rewinds the document.
 * The record is read only when this tab does not already know it (`known`).
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
  drafts();
  try {
    const tx = await transaction('readwrite');
    if (!tx) {
      return true;
    }
    let bytes: number | undefined;
    let written: DraftRecord | undefined;
    let read: DraftRecord | undefined;
    await new Promise<void>((resolve, reject) => {
      const store = tx.objectStore(STORE);
      const write = (previous: DraftRecord | undefined): boolean => {
        const next = mutate(previous);
        if (!next) {
          return false; // nothing to write; the transaction completes on its own
        }
        // A record from before the bytes, or a new document: it goes in as bytes.
        pack(next);
        next.bytes = recordBytes(next, previous);
        bytes = next.bytes;
        written = next;
        store.put(next);
        return true;
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      // A full quota aborts the commit: `abort` fires, `error` never does,
      // and a promise left pending here held up every write queued after it.
      tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
      const remembered = known.get(id);
      if (remembered) {
        // A transaction asked for nothing has nothing to complete with.
        if (!write(remembered)) {
          resolve();
        }
        return;
      }
      const request = store.get(id);
      request.onsuccess = () => {
        read = request.result as DraftRecord | undefined;
        write(read);
      };
    });
    // Told only once the transaction has landed: a `put` that was handed over
    // may still be thrown out with it, and its size is then nobody's.
    if (written) {
      known.set(id, written);
      told(id);
    } else if (read) {
      known.set(id, read);
    }
    if (bytes !== undefined) {
      wrote?.(bytes);
    }
    return true;
  } catch (err) {
    // What landed is not known: the next write reads it.
    known.delete(id);
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
export async function saveDraft(
  id: string,
  doc: unknown,
  state?: DraftState,
  /** The track on screen: written only when the record has none yet — a
   * track attached before the record existed had nowhere to land. */
  audio?: DraftAudio | null,
): Promise<DraftWrite> {
  let bytes = 0;
  const ok = await queueWrite(() =>
    updateDraft(id, 'draft save', (previous) => {
      const next: DraftRecord = { ...previous, id, updated: Date.now(), doc };
      if (state) {
        next.state = state;
      }
      if (audio && !next.audio) {
        next.audio = audio;
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

/**
 * Copies a draft under a fresh id; returns it, or null when there was nothing
 * to copy or the copy did not fit — a full quota answered with the id of a
 * record that was never written.
 */
export async function duplicateDraft(id: string): Promise<string | null> {
  // The bytes go across as they lie: a copy is no reason to read the drawing.
  const source = await rawRecord(id);
  if (!source || source.broken) {
    return null;
  }
  const copy = newDraftId();
  const ok = await queueWrite(() => updateDraft(copy, 'draft duplicate', () => ({ ...source, id: copy, updated: Date.now() })));
  return ok ? copy : null;
}

/** Empties the list. Never throws. */
export async function deleteAllDrafts(): Promise<void> {
  // Only the keys are wanted: no document is read to be deleted.
  const records = await rawRecords().catch(() => [] as DraftRecord[]);
  for (const draft of records) {
    await deleteDraft(draft.id);
  }
}

/**
 * Attaches, replaces or (with `null`) removes the session's track. Never
 * throws; `false` is a track that did not fit (see `updateDraft`).
 */
export async function setDraftAudio(id: string, audio: DraftAudio | null): Promise<boolean> {
  return queueWrite(() =>
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
  known.delete(id);
  try {
    const tx = await transaction('readwrite');
    if (!tx) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      // A full quota aborts the commit: `abort` fires, `error` never does,
      // and a promise left pending here held up every write queued after it.
      tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
    });
    told(id);
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

/** The blob's base64, or undefined when the browser can no longer read it. */
function readable(read: Promise<string>): Promise<string | undefined> {
  return read.catch((err) => {
    console.warn('draft blob unreadable, left out of the file:', err);
    return undefined;
  });
}

/** Plain base64 (ours) or a data URL (toonio.ru's `BLOB2B64`), whose own type wins. */
function base64Bytes(text: string, type: string): { bytes: Uint8Array<ArrayBuffer>; type: string } {
  const url = /^data:([^;,]*)[^,]*,/.exec(text);
  if (url) {
    type = url[1] || type;
    text = text.slice(url[0].length);
  }
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { bytes, type };
}

function fromBase64(text: string, type: string): Blob {
  const decoded = base64Bytes(text, type);
  return new Blob([decoded.bytes], { type: decoded.type });
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
  const chosen = await listDrafts(ids);
  const saves: DraftSave[] = [];
  for (const draft of chosen) {
    const save: DraftSave = {
      id: draft.id,
      updated: draft.updated,
      data: JSON.stringify(draft.doc),
      ...(draft.state ? { state: draft.state } : {}),
    };
    // A stored blob that no longer reads (Safari loses them) cost the whole
    // file: every drawing's backup failed for one card's picture or one
    // track that is gone on this device anyway. The drawing goes without it.
    const screenshot = draft.screenshot && (await readable(toBase64(draft.screenshot)));
    if (screenshot) {
      save.screenshot = screenshot;
    }
    const audio = draft.audio && (await readable(toBase64(draft.audio.blob)));
    if (draft.audio && audio) {
      save.audio = audio;
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
 * counted as broken instead of stopping the rest. Throws only when storage
 * refuses a write (a full quota): what went in before it stays.
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
  const taken = new Set((await rawRecords().catch(() => [] as DraftRecord[])).map((d) => d.id));
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
    const ok = await queueWrite(() =>
      updateDraft(fresh, 'draft import', () => ({ ...record, id: fresh })),
    );
    if (!ok) {
      // Storage full: what did go in stays, and the caller says it stopped.
      throw new Error('draft import did not fit');
    }
    loaded++;
  }
  return { loaded, broken };
}

const HEX = /^#[0-9a-f]{6}$/;
const isInt = (value: unknown): boolean => Number.isInteger(value);
/**
 * A table of brush numbers, each inside what a brush can take: a width of 0
 * or a point spacing of a million came in from a file, went into the hand and
 * the stored settings, and the brush drew nothing until a slider was moved.
 */
const numbers = (value: unknown, min: number, max: number): boolean =>
  typeof value === 'object' && value !== null
  && Object.values(value).every((n) => typeof n === 'number' && n >= min && n <= max);

/**
 * A file's `state` is the editor's own shape, or it is left behind — the draft
 * opens without it. The file is from anywhere: a colour like «red» went
 * straight into the brush, every stroke after it failed the document schema,
 * and the draft dropped off the list with the drawing in it.
 */
function isDraftState(value: unknown): value is DraftState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const state = value as Record<string, unknown>;
  return isInt(state.frame) && isInt(state.layer) && typeof state.tool === 'string'
    && numbers(state.widths, MIN_BRUSH_SIZE_LOGICAL, MAX_BRUSH_SIZE_LOGICAL)
    && numbers(state.smooth, 0, 100) && numbers(state.minDistance, 0, 100)
    && HEX.test(String(state.outline)) && HEX.test(String(state.fill))
    && Array.isArray(state.palette) && state.palette.every((c) => typeof c === 'string' && HEX.test(c))
    && (state.layerColors === undefined || (Array.isArray(state.layerColors) && state.layerColors.every(isInt)));
}

/**
 * A save's `data`: our document as JSON text, or toonio.ru's — the binary
 * `.toon` stream as a data URL (`autosave_worker.js` Export) — decoded into
 * our document, so what is stored is always ours. Null when neither reads.
 */
function readData(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    // Not JSON: a toonio.ru save.
  }
  try {
    const result = decodeToon(base64Bytes(data, '').bytes.buffer);
    return result.ok ? result.doc : null;
  } catch {
    return null; // base64 that is not base64
  }
}

/** One entry of either file shape as a record, or null when it is not one. */
function readSave(entry: unknown): DraftRecord | null {
  if (typeof entry !== 'object' || entry === null) {
    return null;
  }
  const save = entry as Record<string, unknown>;
  // toonio.ru keys a save by its `url`.
  const id = typeof save.id === 'string' ? save.id : save.url;
  if (typeof id !== 'string') {
    return null;
  }
  let doc = save.doc;
  if (typeof save.data === 'string') {
    doc = readData(save.data);
  }
  // A drawing that will not open is dropped from the list when it is read;
  // counted as loaded, «загружено: 2» showed one card.
  if (!parseDraft(doc)) {
    return null;
  }
  const created = typeof save.created === 'string' ? Date.parse(save.created) : NaN;
  // `1e999` reads as Infinity, `1e20` is past the calendar's end: the list
  // sorted by NaN or kept the card first for ever, and it said «Invalid Date».
  const updated = typeof save.updated === 'number' ? new Date(save.updated).getTime() : NaN;
  const record: DraftRecord = {
    id,
    // Nothing was saved in the future: a card from the year 9999 is now.
    updated: Math.min(Date.now(), Number.isFinite(updated) ? updated : Number.isFinite(created) ? created : Date.now()),
    doc,
  };
  if (isDraftState(save.state)) {
    record.state = save.state;
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
