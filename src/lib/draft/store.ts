/**
 * Local draft persistence: one IndexedDB database, one object store, one
 * record per session. Best-effort — every failure (private mode, blocked
 * storage, no IndexedDB) degrades to a no-op with a console.warn and never
 * throws to the caller, so drawing is never interrupted by storage.
 */

import { parseDraft } from './restore';
import { v7Tick } from '../format/v7';
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

/**
 * Separate IndexedDB database for soundtrack bytes (`draft-audio`), keyed by
 * `audioMeta.key`. Keeping large audio out of `drafts` means listing cards and
 * autosaving drawings never touch megabytes of audio, and leaving `toon-editor`
 * at version 2 (with `audio` absent on new records) keeps older tabs and
 * rollbacks from hitting `VersionError` or dereferencing `audio.blob.size`.
 */
const MEDIA_DB_NAME = 'toon-editor-media';
const MEDIA_STORE = 'draft-audio';
const MEDIA_VERSION = 1;

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
  /** Layers locked against new edits, bottom-up; absent on records written before locks existed. */
  layerLocks?: boolean[];
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

/** Lightweight track metadata shown on a draft card without loading audio bytes. */
export interface DraftAudioMeta {
  name: string;
  author: string;
  sync?: boolean;
  bytes?: number;
}

/**
 * A draft as the list shows it: no document, except for a card that has no
 * screenshot yet — its first frame is drawn from the document. Audio stays as
 * metadata only until the draft is opened (`readDraft`) or exported.
 */
export interface DraftCard {
  id: string;
  updated: number;
  summary: DraftSummary;
  audio?: DraftAudioMeta;
  state?: DraftState;
  screenshot?: Blob;
  bytes?: number;
  doc?: ToonDocument;
}

/** Binary payload as kept in IndexedDB — WebKit on iOS fails `put` on Blob values (`UnknownError`). */
interface StoredBytes {
  bytes: Uint8Array<ArrayBuffer>;
  type: string;
}

/** Stored track metadata pointing at a payload in `toon-editor-media` (`draft-audio`). */
interface StoredAudioMeta extends DraftAudioMeta {
  key: string;
  bytes: number;
}

/** Audio record stored in `toon-editor-media` (`draft-audio`). */
interface MediaAudioRecord {
  id: string;
  data: Uint8Array<ArrayBuffer>;
  type: string;
}

/** Record as kept in IndexedDB (`drafts`) and in `known`. */
interface StoredDraftRecord extends Omit<DraftRecord, 'audio' | 'screenshot'> {
  /** Changes with the drawing, track or session state, rather than its thumbnail. */
  editId?: string;
  /** Legacy audio (pre-media-store); never written by new saves so older tabs never dereference `audio.blob.size`. */
  audio?: DraftAudio;
  /** Lightweight metadata for audio stored in `toon-editor-media` (`draft-audio`). */
  audioMeta?: StoredAudioMeta;
  /** Legacy screenshot Blob; never written by new saves. */
  screenshot?: Blob;
  /** Screenshot bytes kept as raw Uint8Array (avoids WebKit Blob `UnknownError`). */
  screenshotData?: StoredBytes;
}

export interface DraftVersion {
  editId?: string;
  updated: number;
  packed: Uint8Array;
  state: string | undefined;
  audio: string | undefined;
  audioUnavailable?: true;
}

function versionOf(record: StoredDraftRecord): DraftVersion | undefined {
  if (!record.packed || record.audio) return undefined;
  return {
    editId: record.editId,
    updated: record.updated,
    packed: record.packed,
    state: JSON.stringify(record.state),
    audio: JSON.stringify(record.audioMeta),
  };
}

function hasVersion(record: StoredDraftRecord | undefined, version: DraftVersion | null): boolean {
  if (!version) return record === undefined;
  if (!record || record.editId !== version.editId || record.updated !== version.updated || record.audio) return false;
  // Older tabs may copy an unfamiliar editId and save in the same millisecond.
  const packed = record.packed;
  if (!packed || packed.length !== version.packed.length) return false;
  for (let i = 0; i < packed.length; i++) {
    if (packed[i] !== version.packed[i]) return false;
  }
  return JSON.stringify(record.state) === version.state && JSON.stringify(record.audioMeta) === version.audio;
}

async function toStoredBytes(blob: Blob): Promise<StoredBytes> {
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type };
}

function buildAudioMeta(key: string, meta: DraftAudioMeta, byteLength: number): StoredAudioMeta {
  const stored: StoredAudioMeta = {
    key,
    name: meta.name,
    author: meta.author,
    bytes: meta.bytes ?? byteLength,
  };
  if (meta.sync !== undefined) {
    stored.sync = meta.sync;
  }
  return stored;
}

function cardAudioMeta(record: StoredDraftRecord): DraftAudioMeta | undefined {
  if (record.audioMeta) {
    const { name, author, sync, bytes } = record.audioMeta;
    return { name, author, ...(sync !== undefined ? { sync } : {}), ...(bytes !== undefined ? { bytes } : {}) };
  }
  if (record.audio) {
    const { name, author, sync, bytes, blob } = record.audio;
    const size = bytes ?? blob?.size;
    return { name, author, ...(sync !== undefined ? { sync } : {}), ...(size !== undefined ? { bytes: size } : {}) };
  }
  return undefined;
}

function restoreScreenshot(record: StoredDraftRecord): Blob | undefined {
  if (record.screenshotData) {
    return new Blob([record.screenshotData.bytes], { type: record.screenshotData.type });
  }
  return record.screenshot;
}

function hasLegacyBlob(record: StoredDraftRecord | undefined): boolean {
  return Boolean(record && (record.screenshot !== undefined || record.audio?.blob !== undefined));
}

function sameLegacySnapshot(a: StoredDraftRecord, b: StoredDraftRecord): boolean {
  return (
    a.updated === b.updated
    && a.bytes === b.bytes
    && (a.screenshot !== undefined) === (b.screenshot !== undefined)
    && (a.audio?.blob !== undefined) === (b.audio?.blob !== undefined)
  );
}

/** What the track and the screenshot add to a record. */
function blobBytes(record: StoredDraftRecord): number {
  const audioSize = record.audioMeta?.bytes ?? record.audio?.blob?.size ?? 0;
  const shotSize = record.screenshotData?.bytes.byteLength ?? record.screenshot?.size ?? 0;
  return audioSize + shotSize;
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

/** A record as the rest of the studio reads it: the document in `doc`, screenshot restored from bytes. */
function opened(record: StoredDraftRecord, audio?: DraftAudio): DraftRecord {
  const { packed, screenshotData, audioMeta: _meta, audio: legacyAudio, screenshot, ...rest } = record;
  let doc: unknown = rest.doc;
  if (packed) {
    doc = null;
    try {
      doc = unpackDocument(JSON.parse(new TextDecoder().decode(packed)));
    } catch {
      // Bytes that do not read: the record lists with no document, as a broken one did.
    }
  }
  const resolvedAudio = audio ?? legacyAudio;
  const restoredScreenshot = screenshotData
    ? new Blob([screenshotData.bytes], { type: screenshotData.type })
    : screenshot;
  return {
    ...rest,
    doc,
    ...(resolvedAudio ? { audio: resolvedAudio } : {}),
    ...(restoredScreenshot ? { screenshot: restoredScreenshot } : {}),
  };
}

function summarize(doc: unknown): DraftSummary | null {
  if (typeof doc !== 'object' || doc === null || !Array.isArray((doc as ToonDocument).layers)) {
    return null;
  }
  const { width, height, layers } = doc as ToonDocument;
  // A version 7 record counts its pauses as the ticks they open into.
  const columns = layers[0]?.frames?.length ?? 0;
  return { width, height, frames: v7Tick(doc, columns), layers: layers.length };
}

/**
 * Puts the record's document into bytes, if it came as a document — a save,
 * a copy, an import. A write that kept the document it read (the screenshot,
 * the track, its credits) keeps its bytes as they are.
 */
function pack(record: StoredDraftRecord): void {
  // A record marked broken stays as it lay: its document did not read, so a
  // card counted from it would list it, and packing a tree that is not a
  // document can throw inside the write. A save clears the mark.
  if (record.doc !== undefined && !record.broken) {
    const summary = summarize(record.doc);
    if (summary) {
      record.summary = summary;
    }
    record.packed = encodeDoc(record.doc);
    delete (record as Partial<StoredDraftRecord>).doc;
  }
}

/**
 * What the record weighs: the document's bytes, track and screenshot. A write
 * that kept the bytes it read carries their share over instead of weighing
 * them again.
 */
function recordBytes(record: StoredDraftRecord, previous: StoredDraftRecord | undefined): number {
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
      reject(new DOMException('IndexedDB unavailable', 'StorageUnavailable'));
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
    req.onblocked = () => reject(new DOMException('another tab holds an older draft database', 'UpgradeBlocked'));
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

function errorName(error: unknown): string {
  return error instanceof Error || error instanceof DOMException ? error.name : '';
}

function isRetriableStorageError(error: unknown): boolean {
  const name = errorName(error);
  return name === 'UnknownError' || name === 'InvalidStateError' || name === 'AbortError';
}

function isPageHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden === true;
}

function isExpectedHiddenScreenshotAbort(operation: DraftOperation, error: unknown): boolean {
  return operation === 'draft screenshot save' && errorName(error) === 'AbortError' && isPageHidden();
}

function resetConnection(pending: Promise<IDBDatabase> | undefined): void {
  if (!pending || shared?.db !== pending) {
    return;
  }
  shared = null;
  known.clear();
  void pending.then((db) => {
    try { db.close(); } catch { /* already closed */ }
  }).catch(() => {});
}

/**
 * A transaction on the page's connection. Safari drops the connection of a tab
 * left in the background («Connection to Indexed Database server lost») and
 * says nothing until `transaction()` throws — or fails `open` / an active
 * transaction asynchronously with `UnknownError`. The connection kept for the
 * page is given up, closed, and opened once more. Null: no storage at all
 * (`connection` refused) — a quiet degradation (unless `throwOnOpenFailure`
 * is set because we are reopening after a failed write).
 */
async function transaction(
  mode: IDBTransactionMode,
  unavailable?: (error: unknown, retried: boolean) => void,
  throwOnOpenFailure = false,
  shouldSkip?: () => boolean,
): Promise<IDBTransaction | null> {
  for (let attempt = 0; ; attempt++) {
    if (shouldSkip?.()) {
      return null;
    }
    const pending = connection();
    let db: IDBDatabase;
    try {
      db = await pending;
    } catch (err) {
      if (shared?.db === pending) {
        shared = null;
      }
      if (shouldSkip?.()) {
        return null;
      }
      if (attempt === 0 && errorName(err) === 'UnknownError') {
        continue;
      }
      if (throwOnOpenFailure) {
        throw err;
      }
      unavailable?.(err, attempt > 0);
      console.warn('draft storage unavailable:', err);
      return null;
    }
    if (shouldSkip?.()) {
      return null;
    }
    try {
      return db.transaction(STORE, mode);
    } catch (err) {
      resetConnection(pending);
      if (attempt > 0) {
        throw err;
      }
    }
  }
}

function openMediaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new DOMException('IndexedDB unavailable', 'StorageUnavailable'));
      return;
    }
    const req = indexedDB.open(MEDIA_DB_NAME, MEDIA_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        db.createObjectStore(MEDIA_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new DOMException('another tab holds an older draft media database', 'UpgradeBlocked'));
  });
}

let mediaShared: { factory: unknown; db: Promise<IDBDatabase> } | null = null;

function mediaConnection(): Promise<IDBDatabase> {
  const factory = typeof indexedDB === 'undefined' ? undefined : indexedDB;
  if (mediaShared && mediaShared.factory === factory) {
    return mediaShared.db;
  }
  const db = openMediaDb().then((openedDb) => {
    openedDb.onversionchange = () => {
      openedDb.close();
      if (mediaShared?.db === db) {
        mediaShared = null;
      }
    };
    openedDb.onclose = () => {
      if (mediaShared?.db === db) {
        mediaShared = null;
      }
    };
    return openedDb;
  });
  db.catch(() => {
    if (mediaShared?.db === db) {
      mediaShared = null;
    }
  });
  mediaShared = { factory, db };
  return db;
}

function resetMediaConnection(pending: Promise<IDBDatabase> | undefined): void {
  if (!pending || mediaShared?.db !== pending) {
    return;
  }
  mediaShared = null;
  void pending.then((db) => {
    try { db.close(); } catch { /* already closed */ }
  }).catch(() => {});
}

async function mediaTransaction(mode: IDBTransactionMode, throwOnOpenFailure = false): Promise<IDBTransaction | null> {
  for (let attempt = 0; ; attempt++) {
    const pending = mediaConnection();
    let db: IDBDatabase;
    try {
      db = await pending;
    } catch (err) {
      if (mediaShared?.db === pending) {
        mediaShared = null;
      }
      if (attempt === 0 && errorName(err) === 'UnknownError') {
        continue;
      }
      if (throwOnOpenFailure) {
        throw err;
      }
      return null;
    }
    try {
      return db.transaction(MEDIA_STORE, mode);
    } catch (err) {
      resetMediaConnection(pending);
      if (attempt > 0) {
        throw err;
      }
    }
  }
}

async function putMediaAudio(key: string, payload: StoredBytes): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const tx = await mediaTransaction('readwrite', true);
    if (!tx) {
      throw new DOMException('IndexedDB unavailable', 'StorageUnavailable');
    }
    const used = mediaShared?.db;
    try {
      await new Promise<void>((resolve, reject) => {
        const record: MediaAudioRecord = { id: key, data: payload.bytes, type: payload.type };
        tx.objectStore(MEDIA_STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = (event) => reject((event?.target as IDBRequest | null)?.error ?? tx.error);
        tx.onabort = () => reject(tx.error ?? new DOMException('transaction aborted', 'AbortError'));
      });
      return;
    } catch (err) {
      if (isRetriableStorageError(err)) {
        resetMediaConnection(used);
        if (attempt === 0) {
          continue;
        }
      }
      throw err;
    }
  }
}

async function getMediaAudio(key: string): Promise<MediaAudioRecord | undefined> {
  for (let attempt = 0; ; attempt++) {
    const tx = await mediaTransaction('readonly');
    if (!tx) {
      return undefined;
    }
    const used = mediaShared?.db;
    try {
      return await new Promise<MediaAudioRecord | undefined>((resolve, reject) => {
        const req = tx.objectStore(MEDIA_STORE).get(key);
        req.onsuccess = () => resolve(req.result as MediaAudioRecord | undefined);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      if (isRetriableStorageError(err)) {
        resetMediaConnection(used);
        if (attempt === 0) {
          continue;
        }
      }
      console.warn('draft audio read failed:', err);
      return undefined;
    }
  }
}

async function deleteMediaAudio(key: string): Promise<void> {
  try {
    const tx = await mediaTransaction('readwrite');
    if (!tx) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      tx.objectStore(MEDIA_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new DOMException('transaction aborted', 'AbortError'));
    });
  } catch (err) {
    console.warn('draft audio delete failed:', err);
  }
}

/** A Blob can be reused only when this exact file is already on the draft. */
const savedAudioKeys = new WeakMap<Blob, string>();

async function loadRecordAudio(record: StoredDraftRecord): Promise<DraftAudio | undefined> {
  if (record.audioMeta) {
    const media = await getMediaAudio(record.audioMeta.key);
    if (!media) {
      return undefined;
    }
    const blob = new Blob([media.data], { type: media.type });
    savedAudioKeys.set(blob, record.audioMeta.key);
    const restored: DraftAudio = {
      blob,
      name: record.audioMeta.name,
      author: record.audioMeta.author,
      bytes: record.audioMeta.bytes,
    };
    if (record.audioMeta.sync !== undefined) {
      restored.sync = record.audioMeta.sync;
    }
    return restored;
  }
  return record.audio;
}

/**
 * Saved drafts with their documents, newest first — every one, or only those
 * of `ids`, read before any document is: an export of two drafts does not read
 * the rest. The list on screen reads `listDraftCards` instead.
 */
export async function listDrafts(ids?: readonly string[]): Promise<DraftRecord[]> {
  try {
    const picked = (await rawRecords()).filter((record) => !ids || ids.includes(record.id));
    const all = await Promise.all(picked.map(async (record) => opened(record, await loadRecordAudio(record))));
    return all.sort((a, b) => b.updated - a.updated);
  } catch (err) {
    console.warn('draft list failed:', err);
    return [];
  }
}

/** Every record as it lies in the base, the document still in bytes. */
async function rawRecords(): Promise<StoredDraftRecord[]> {
  // After the writes already asked for: a list read around them showed the
  // record from before the save that was just made.
  await writes;
  const tx = await transaction('readonly');
  if (!tx) {
    return [];
  }
  return new Promise<StoredDraftRecord[]>((resolve, reject) => {
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as StoredDraftRecord[]);
    req.onerror = () => reject(req.error);
  });
}

async function rawRecord(id: string): Promise<StoredDraftRecord | undefined> {
  await writes;
  return readStoredRecord(id);
}

async function readStoredRecord(id: string): Promise<StoredDraftRecord | undefined> {
  try {
    const tx = await transaction('readonly');
    if (!tx) {
      return undefined;
    }
    return await new Promise<StoredDraftRecord | undefined>((resolve, reject) => {
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result as StoredDraftRecord | undefined);
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
  let records: StoredDraftRecord[];
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
        }, undefined, true),
      );
      if (!found) {
        continue;
      }
      summary = found;
    }
    const screenshot = restoreScreenshot(record);
    const audio = cardAudioMeta(record);
    if (!screenshot && doc === undefined) {
      doc = parseDraft(opened(record).doc, true);
    }
    const { id, updated, state, bytes } = record;
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
 * The document (and soundtrack, if any) of one draft, read and checked as any
 * input is — once, when it is opened. Null for a draft that is gone or does
 * not read.
 */
export async function readDraft(id: string): Promise<{
  doc: ToonDocument;
  state?: DraftState;
  audio?: DraftAudio;
  audioUnavailable?: true;
  version?: DraftVersion;
} | null> {
  const record = await rawRecord(id);
  if (!record) {
    return null;
  }
  const raw = opened(record).doc;
  // A version 7 draft kept its frame as a column; its tick is read off the
  // holds before the translation drops them.
  const state = record.state && { ...record.state, frame: v7Tick(raw, record.state.frame) };
  const doc = parseDraft(raw, true);
  if (!doc) {
    return null;
  }
  const audio = await loadRecordAudio(record);
  const audioUnavailable = Boolean(record.audioMeta && !audio);
  const version = versionOf(record);
  if (version && audioUnavailable) version.audioUnavailable = true;
  return {
    doc,
    ...(state ? { state } : {}),
    ...(audio ? { audio } : {}),
    ...(audioUnavailable ? { audioUnavailable: true } : {}),
    ...(version ? { version } : {}),
  };
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
const known = new Map<string, StoredDraftRecord>();

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

type DraftOperation = 'draft save' | 'draft audio save' | 'draft credits save' | 'draft screenshot save' | 'draft import' | 'draft duplicate' | 'draft card';
export type DraftFailureStage = 'open' | 'transaction' | 'get' | 'put' | 'abort' | 'blob';
export type DraftFailureReason = 'connection_lost' | 'blob_error' | 'backing_store' | 'disk_full' | 'io_error' | 'db_busy' | 'tx_inactive';
export type DraftFailureDetail = {
  stage: DraftFailureStage;
  reason?: DraftFailureReason;
  retried?: boolean;
};
type DraftListener = (operation: DraftOperation, cause: string, detail?: DraftFailureDetail) => void;
const draftListeners = new Set<DraftListener>();
const failing = new Set<DraftOperation>();
const storageErrors = new Set(['QuotaExceededError', 'AbortError', 'SecurityError', 'DataCloneError', 'DataError',
  'ConstraintError', 'InvalidStateError', 'NotFoundError', 'ReadOnlyError', 'TransactionInactiveError',
  'UnknownError', 'VersionError', 'TypeError', 'RangeError', 'StorageUnavailable', 'UpgradeBlocked']);

const reasonPatterns: readonly [RegExp, DraftFailureReason][] = [
  [/server lost|connection.*closed|database connection is closing/i, 'connection_lost'],
  [/blob|file data|notreadable/i, 'blob_error'],
  [/backing store|opening database|open.*database|unable to open/i, 'backing_store'],
  [/quota|disk.*full|no space|sqlite_full/i, 'disk_full'],
  [/ioerr|i\/o|disk.*error|corrupt|malformed/i, 'io_error'],
  [/busy|locked|sqlite_busy/i, 'db_busy'],
  [/transaction.*inactive|not active/i, 'tx_inactive'],
];

function classifyReason(error: unknown): DraftFailureReason | undefined {
  const message = error instanceof Error || error instanceof DOMException ? error.message : '';
  if (!message) {
    return undefined;
  }
  for (const [pattern, reason] of reasonPatterns) {
    if (pattern.test(message)) {
      return reason;
    }
  }
  return undefined;
}

export function onDraftFailure(listener: DraftListener): () => void {
  draftListeners.add(listener);
  return () => { draftListeners.delete(listener); };
}

function draftFailed(operation: DraftOperation, error: unknown, stage: DraftFailureStage, retried = false): void {
  if (failing.has(operation) || !draftListeners.size) return;
  failing.add(operation);
  const name = errorName(error);
  const cause = storageErrors.has(name) ? name : 'unknown';
  const reason = classifyReason(error);
  const detail: DraftFailureDetail = {
    stage,
    ...(reason ? { reason } : {}),
    ...(retried ? { retried: true } : {}),
  };
  for (const listener of draftListeners) {
    try { listener(operation, cause, detail); } catch { /* Reporting must not interrupt the write queue. */ }
  }
}

interface PreparedLegacyMigration {
  source: StoredDraftRecord;
  screenshotData?: StoredBytes;
  audioMeta?: StoredAudioMeta;
  createdMediaKey?: string;
}

async function prepareLegacyMigration(source: StoredDraftRecord): Promise<PreparedLegacyMigration> {
  const prepared: PreparedLegacyMigration = { source };
  if (source.screenshot !== undefined && !source.screenshotData) {
    try {
      prepared.screenshotData = await toStoredBytes(source.screenshot);
    } catch (err) {
      // Safari loses stored blobs on disk; drop the stale thumbnail so the drawing still saves.
      console.warn('legacy draft screenshot unreadable, dropping:', err);
    }
  }
  if (source.audio?.blob !== undefined && !source.audioMeta) {
    try {
      const payload = await toStoredBytes(source.audio.blob);
      const key = newDraftId();
      await putMediaAudio(key, payload);
      prepared.createdMediaKey = key;
      prepared.audioMeta = buildAudioMeta(key, source.audio, payload.bytes.byteLength);
    } catch (err) {
      console.warn('legacy draft audio unreadable, dropping:', err);
    }
  }
  return prepared;
}

function applyLegacyMigration(fresh: StoredDraftRecord, migration: PreparedLegacyMigration): { cleaned: StoredDraftRecord; usedMedia: boolean } {
  const cleaned: StoredDraftRecord = { ...fresh };
  delete cleaned.screenshot;
  delete cleaned.audio;
  if (migration.screenshotData && !cleaned.screenshotData) {
    cleaned.screenshotData = migration.screenshotData;
  }
  let usedMedia = false;
  if (migration.audioMeta && !cleaned.audioMeta) {
    cleaned.audioMeta = migration.audioMeta;
    usedMedia = true;
  }
  return { cleaned, usedMedia };
}

/**
 * Read-modify-write of one record in a single transaction, so an autosave
 * never drops the track and attaching a track never rewinds the document.
 * The record is read only when this tab does not already know it (`known`).
 * `mutate` returning null writes nothing — that is how a side write (the
 * screenshot, the track, its credits) declines to resurrect a record that was
 * deleted while it was in flight. Never throws; `false` means the write into
 * working storage failed (a full quota, or a reopen failure after an active
 * write failed), which is the only case worth telling anyone about — having no
 * IndexedDB at all on initial open is a quiet degradation and reads as `true`.
 */
async function updateDraft(
  id: string,
  what: DraftOperation,
  mutate: (previous: StoredDraftRecord | undefined) => StoredDraftRecord | null,
  /** What the record turned out to weigh — the write already knows. */
  wrote?: (bytes: number, version?: DraftVersion) => void,
  /** Replacing media requires its current key, even before the other tab's notice arrives. */
  readFresh = false,
  unavailable?: () => void,
): Promise<boolean> {
  let stage: DraftFailureStage = 'transaction';
  let retried = false;
  try {
    drafts();
    let bytes: number | undefined;
    let written: StoredDraftRecord | undefined;
    let read: StoredDraftRecord | undefined;
    const runAttempt = async (reopening: boolean): Promise<boolean> => {
      bytes = undefined;
      written = undefined;
      read = undefined;
      let needsMigration: StoredDraftRecord | undefined;
      let migrationUsedMedia = false;
      const skipHiddenScreenshot = what === 'draft screenshot save' ? isPageHidden : undefined;
      const runTx = async (migration?: PreparedLegacyMigration): Promise<boolean> => {
        if (skipHiddenScreenshot?.()) {
          return false;
        }
        stage = reopening ? 'open' : 'transaction';
        const tx = await transaction(
          'readwrite',
          (error, openRetried) => draftFailed(what, error, 'open', openRetried),
          reopening,
          skipHiddenScreenshot,
        );
        if (!tx) {
          return false;
        }
        stage = 'transaction';
        const used = shared?.db;
        try {
          await new Promise<void>((resolve, reject) => {
            let settled = false;
            const fail = (error: unknown, at?: DraftFailureStage) => {
              if (settled) return;
              settled = true;
              if (at) stage = at;
              reject(error);
            };
            const store = tx.objectStore(STORE);
            const write = (previous: StoredDraftRecord | undefined): boolean => {
              const next = mutate(previous);
              if (!next) {
                return false; // nothing to write; the transaction completes on its own
              }
              if (what !== 'draft screenshot save' && what !== 'draft card') {
                next.editId = newDraftId();
              }
              stage = 'put';
              // A record from before the bytes, or a new document: it goes in as bytes.
              pack(next);
              next.bytes = recordBytes(next, previous);
              bytes = next.bytes;
              written = next;
              store.put(next);
              return true;
            };
            tx.oncomplete = () => {
              if (!settled) {
                settled = true;
                resolve();
              }
            };
            tx.onerror = (event) => {
              // A request's error bubbles before the transaction starts aborting.
              fail((event?.target as IDBRequest | null)?.error ?? tx.error);
            };
            // A full quota aborts the commit: `abort` fires, `error` never does,
            // and a promise left pending here held up every write queued after it.
            tx.onabort = () => fail(tx.error ?? new DOMException('transaction aborted', 'AbortError'), 'abort');
            if (migration !== undefined) {
              // Re-read in the write transaction so a concurrent delete or edit
              // by another tab during Blob conversion is never undone.
              stage = 'get';
              const freshReq = store.get(id);
              freshReq.onsuccess = () => {
                const fresh = freshReq.result as StoredDraftRecord | undefined;
                read = fresh;
                if (!fresh) {
                  try { write(undefined); } catch (error) { fail(error); }
                  return;
                }
                if (sameLegacySnapshot(fresh, migration.source)) {
                  const applied = applyLegacyMigration(fresh, migration);
                  migrationUsedMedia = applied.usedMedia;
                  read = applied.cleaned;
                  try { write(applied.cleaned); } catch (error) { fail(error); }
                  return;
                }
                if (!hasLegacyBlob(fresh)) {
                  // Another tab already updated/migrated this record; apply on top of the latest state.
                  try { write(fresh); } catch (error) { fail(error); }
                  return;
                }
                // Another tab wrote a different legacy record while we migrated: retry once.
                needsMigration = fresh;
              };
              return;
            }
            // Read `known` only after `transaction()` has ensured `connection()`
            // matches the active `indexedDB` factory (which clears `known` on swap).
            const remembered = readFresh ? undefined : known.get(id);
            if (remembered) {
              if (hasLegacyBlob(remembered)) {
                needsMigration = remembered;
                settled = true;
                resolve();
                return;
              }
              // A transaction asked for nothing has nothing to complete with.
              if (!write(remembered)) {
                settled = true;
                resolve();
              }
              return;
            }
            stage = 'get';
            const request = store.get(id);
            request.onsuccess = () => {
              read = request.result as StoredDraftRecord | undefined;
              // Legacy records kept `screenshot` / `audio.blob` as IndexedDB Blobs;
              // migrate them outside the transaction so WebKit never receives a Blob in `store.put()`.
              if (hasLegacyBlob(read)) {
                needsMigration = read;
                return;
              }
              try { write(read); } catch (error) { fail(error); }
            };
          });
          return true;
        } catch (err) {
          if (isRetriableStorageError(err)) {
            resetConnection(used);
          }
          throw err;
        }
      };
      if (!(await runTx())) {
        return false;
      }
      for (let pass = 0; needsMigration && pass < 2; pass++) {
        if (skipHiddenScreenshot?.()) {
          return false;
        }
        const toMigrate = needsMigration;
        needsMigration = undefined;
        migrationUsedMedia = false;
        const prepared = await prepareLegacyMigration(toMigrate);
        try {
          if (!(await runTx(prepared))) {
            if (prepared.createdMediaKey) {
              void deleteMediaAudio(prepared.createdMediaKey);
            }
            return false;
          }
        } catch (err) {
          if (prepared.createdMediaKey) {
            void deleteMediaAudio(prepared.createdMediaKey);
          }
          throw err;
        }
        if (prepared.createdMediaKey && (!migrationUsedMedia || !written)) {
          void deleteMediaAudio(prepared.createdMediaKey);
        }
      }
      if (needsMigration) {
        throw new DOMException('concurrent legacy draft update during migration', 'AbortError');
      }
      return true;
    };
    for (let attempt = 0; ; attempt++) {
      try {
        const openedStorage = await runAttempt(attempt > 0);
        if (!openedStorage) {
          unavailable?.();
          return true;
        }
        break;
      } catch (err) {
        if (attempt === 0 && isRetriableStorageError(err) && !isExpectedHiddenScreenshotAbort(what, err)) {
          retried = true;
          continue;
        }
        throw err;
      }
    }
    // Told only once the transaction has landed: a `put` that was handed over
    // may still be thrown out with it, and its size is then nobody's.
    if (written) {
      failing.delete(what);
      known.set(id, written);
      told(id);
    } else if (read) {
      known.set(id, read);
    }
    if (bytes !== undefined && written) {
      wrote?.(bytes, versionOf(written));
    }
    return true;
  } catch (err) {
    // What landed is not known: the next write reads it.
    known.delete(id);
    if (!isExpectedHiddenScreenshotAbort(what, err)) {
      draftFailed(what, err, stage, retried);
    }
    console.warn(`${what} failed:`, err);
    return false;
  }
}

/** What one draft write did: whether it landed, and what the record weighs. */
export interface DraftEdit {
  ok: boolean;
  version?: DraftVersion;
  conflict?: true;
}

export interface DraftWrite extends DraftEdit {
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
  /** By default this fills in a track attached before the record existed. */
  audio?: DraftAudio | null,
  /** Publication also invalidates the thumbnail and requires a committed record. */
  { forPublication = false, replaceAudio = forPublication, expectedVersion }: {
    forPublication?: boolean;
    replaceAudio?: boolean;
    expectedVersion?: DraftVersion | null;
  } = {},
): Promise<DraftWrite> {
  let bytes = 0;
  let version: DraftVersion | undefined;
  let conflict = false;
  const ok = await queueWrite(async () => {
    let stagedAudio: StoredAudioMeta | undefined;
    let stagedKey: string | undefined;
    let attachedStaged = false;
    let audioFailed = false;
    const activeFactory = typeof indexedDB === 'undefined' ? undefined : indexedDB;
    const cached = shared && shared.factory === activeFactory ? known.get(id) : undefined;
    const savedKey = replaceAudio && audio ? savedAudioKeys.get(audio.blob) : undefined;
    const storedMeta = savedKey ? (cached ?? await readStoredRecord(id))?.audioMeta : undefined;
    const reusedAudio = audio && storedMeta && storedMeta.key === savedKey
      ? buildAudioMeta(storedMeta.key, audio, storedMeta.bytes)
      : undefined;
    if (audio && (replaceAudio ? !reusedAudio : !cached?.audioMeta && !cached?.audio)) {
      let stage: DraftFailureStage = 'blob';
      try {
        const payload = await toStoredBytes(audio.blob);
        const key = newDraftId();
        stage = 'put';
        await putMediaAudio(key, payload);
        stagedKey = key;
        stagedAudio = buildAudioMeta(key, audio, payload.bytes.byteLength);
      } catch (err) {
        if (replaceAudio) {
          draftFailed('draft audio save', err, stage);
          audioFailed = true;
        } else {
          console.warn('draft audio unreadable during save, keeping drawing:', err);
        }
      }
    }
    let landed = false;
    let unavailable = false;
    let replacedKey: string | undefined;
    const wroteOk = await updateDraft(id, 'draft save', (previous) => {
      if (expectedVersion !== undefined && !hasVersion(previous, expectedVersion)) {
        conflict = true;
        return null;
      }
      if (audioFailed) return null;
      // A different tab may have replaced the track since it was checked.
      if (reusedAudio && previous?.audioMeta?.key !== reusedAudio.key) return null;
      const next: StoredDraftRecord = { ...previous, id, updated: Date.now(), doc };
      // The studio's own drawing: whatever did not read before is replaced.
      delete next.broken;
      if (state) {
        next.state = state;
      }
      if (forPublication) {
        delete next.screenshot;
        delete next.screenshotData;
      }
      if (replaceAudio) {
        replacedKey = next.audioMeta?.key;
        delete next.audio;
        const currentAudio = reusedAudio ?? stagedAudio;
        if (currentAudio) next.audioMeta = currentAudio;
        else delete next.audioMeta;
        attachedStaged = stagedAudio !== undefined;
      } else if (stagedAudio && !next.audioMeta && !next.audio) {
        next.audioMeta = stagedAudio;
        attachedStaged = true;
      }
      return next;
    }, (writtenBytes, writtenVersion) => {
      bytes = writtenBytes;
      version = writtenVersion;
      landed = true;
    }, replaceAudio || expectedVersion !== undefined, () => { unavailable = true; });
    if (stagedKey) {
      if (audio && wroteOk && landed && attachedStaged) {
        savedAudioKeys.set(audio.blob, stagedKey);
      } else {
        await deleteMediaAudio(stagedKey);
      }
    }
    if (wroteOk && landed && replacedKey && replacedKey !== reusedAudio?.key) {
      await deleteMediaAudio(replacedKey);
    }
    if (replaceAudio && wroteOk && landed) {
      failing.delete('draft audio save');
    }
    return wroteOk && (landed || (unavailable && !forPublication));
  });
  return { ok, bytes, ...(version ? { version } : {}), ...(conflict ? { conflict: true as const } : {}) };
}

/**
 * Stores the card's thumbnail on its own — it is rendered when the CPU is
 * idle, which can be after the draft was deleted. A record that is no longer
 * there is not recreated for the sake of a picture of it.
 */
export async function setDraftScreenshot(id: string, screenshot: Blob, expectedVersion?: DraftVersion): Promise<void> {
  await queueWrite(async () => {
    if (isPageHidden()) {
      return;
    }
    let screenshotData: StoredBytes;
    try {
      screenshotData = await toStoredBytes(screenshot);
    } catch (err) {
      console.warn('draft screenshot unreadable:', err);
      return;
    }
    if (isPageHidden()) {
      return;
    }
    await updateDraft(id, 'draft screenshot save', (previous) => {
      if (!previous || (expectedVersion && !hasVersion(previous, expectedVersion))) {
        return null;
      }
      const next: StoredDraftRecord = { ...previous, screenshotData };
      delete next.screenshot;
      return next;
    }, undefined, expectedVersion !== undefined);
  });
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
  const clean: StoredDraftRecord = { ...source };
  let copiedMediaKey: string | undefined;
  if (clean.screenshot !== undefined) {
    if (!clean.screenshotData) {
      try {
        clean.screenshotData = await toStoredBytes(clean.screenshot);
      } catch (err) {
        console.warn('legacy draft screenshot unreadable during duplicate, dropping:', err);
      }
    }
    delete clean.screenshot;
  }
  if (clean.audioMeta) {
    const media = await getMediaAudio(clean.audioMeta.key);
    if (media) {
      const freshKey = newDraftId();
      try {
        await putMediaAudio(freshKey, { bytes: media.data, type: media.type });
        copiedMediaKey = freshKey;
        clean.audioMeta = { ...clean.audioMeta, key: freshKey };
      } catch (err) {
        draftFailed('draft duplicate', err, 'put');
        console.warn('draft audio copy failed:', err);
        return null;
      }
    } else {
      delete clean.audioMeta;
    }
  } else if (clean.audio?.blob !== undefined) {
    try {
      const payload = await toStoredBytes(clean.audio.blob);
      const freshKey = newDraftId();
      await putMediaAudio(freshKey, payload);
      copiedMediaKey = freshKey;
      clean.audioMeta = buildAudioMeta(freshKey, clean.audio, payload.bytes.byteLength);
    } catch (err) {
      console.warn('legacy draft audio unreadable during duplicate, dropping:', err);
    }
    delete clean.audio;
  }
  const copy = newDraftId();
  let landed = false;
  const ok = await queueWrite(() =>
    updateDraft(copy, 'draft duplicate', () => ({ ...clean, id: copy, updated: Date.now() }), () => {
      landed = true;
    }),
  );
  if (!ok || !landed) {
    if (copiedMediaKey) {
      await deleteMediaAudio(copiedMediaKey);
    }
    return null;
  }
  return copy;
}

/** Empties the list. Never throws. */
export async function deleteAllDrafts(): Promise<void> {
  // Only the keys are wanted: no document is read to be deleted.
  const records = await rawRecords().catch(() => [] as StoredDraftRecord[]);
  for (const draft of records) {
    await deleteDraft(draft.id);
  }
}

/**
 * Attaches, replaces or (with `null`) removes the session's track. Never
 * throws; unsuccessful writes leave the existing track in place.
 */
export async function setDraftAudio(id: string, audio: DraftAudio | null, expectedVersion?: DraftVersion | null): Promise<DraftEdit> {
  return queueWrite(async () => {
    let nextMeta: StoredAudioMeta | null = null;
    let newKey: string | undefined;
    if (audio) {
      let payload: StoredBytes;
      try {
        payload = await toStoredBytes(audio.blob);
      } catch (err) {
        console.warn('draft audio unreadable:', err);
        draftFailed('draft audio save', err, 'blob');
        return { ok: false };
      }
      newKey = newDraftId();
      try {
        await putMediaAudio(newKey, payload);
      } catch (err) {
        draftFailed('draft audio save', err, 'put');
        console.warn('draft audio save failed:', err);
        return { ok: false };
      }
      nextMeta = buildAudioMeta(newKey, audio, payload.bytes.byteLength);
    }
    let replacedKey: string | undefined;
    let landed = false;
    let version: DraftVersion | undefined;
    let conflict = false;
    const ok = await updateDraft(id, 'draft audio save', (previous) => {
      if (expectedVersion !== undefined && !hasVersion(previous, expectedVersion)) {
        conflict = true;
        return null;
      }
      if (!previous) {
        // Nothing drawn yet, or the record is gone: a track alone is not a draft.
        return null;
      }
      replacedKey = previous.audioMeta?.key;
      const next: StoredDraftRecord = { ...previous, id, updated: Date.now() };
      delete next.audio;
      if (nextMeta) {
        next.audioMeta = nextMeta;
      } else {
        delete next.audioMeta;
      }
      return next;
    }, (_bytes, committed) => {
      landed = true;
      version = committed;
    }, expectedVersion !== undefined);
    if (ok && landed) {
      if (audio && newKey) savedAudioKeys.set(audio.blob, newKey);
      if (replacedKey && replacedKey !== newKey) {
        await deleteMediaAudio(replacedKey);
      }
    } else if (newKey) {
      await deleteMediaAudio(newKey);
    }
    return { ok: ok && !conflict && (landed || expectedVersion == null), ...(version ? { version } : {}), ...(conflict ? { conflict: true as const } : {}) };
  });
}

/** Removes one session. Never throws. */
export async function deleteDraft(id: string): Promise<void> {
  await queueWrite(() => removeDraft(id));
}

/** Delete only the submitted version, comparing it in the delete transaction. */
export function deleteDraftIfVersion(id: string, version: DraftVersion): Promise<boolean> {
  if (version.audioUnavailable) return Promise.resolve(false);
  return queueWrite(() => removeDraft(id, version));
}

async function removeDraft(id: string, expectedVersion?: DraftVersion): Promise<boolean> {
  const cachedKey = known.get(id)?.audioMeta?.key;
  known.delete(id);
  try {
    const tx = await transaction('readwrite');
    if (!tx) {
      return false;
    }
    let audioKey = cachedKey;
    let removed = false;
    await new Promise<void>((resolve, reject) => {
      const store = tx.objectStore(STORE);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      // A full quota aborts the commit: `abort` fires, `error` never does,
      // and a promise left pending here held up every write queued after it.
      tx.onabort = () => reject(tx.error ?? new DOMException('transaction aborted', 'AbortError'));
      const req = store.get(id);
      req.onsuccess = () => {
        const existing = req.result as StoredDraftRecord | undefined;
        if (expectedVersion && !hasVersion(existing, expectedVersion)) {
          return;
        }
        audioKey = existing?.audioMeta?.key ?? cachedKey;
        store.delete(id);
        removed = true;
      };
    });
    if (!removed) return false;
    if (audioKey) {
      await deleteMediaAudio(audioKey);
    }
    told(id);
    return true;
  } catch (err) {
    console.warn('draft delete failed:', err);
    return false;
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
  expectedVersion?: DraftVersion | null,
): Promise<DraftEdit> {
  return queueWrite(async () => {
    let version: DraftVersion | undefined;
    let conflict = false;
    const ok = await updateDraft(id, 'draft credits save', (previous) => {
      if (expectedVersion !== undefined && !hasVersion(previous, expectedVersion)) {
        conflict = true;
        return null;
      }
      if (!previous?.audioMeta) {
        return null; // no record, or no track on it — nothing to name
      }
      return {
        ...previous,
        id,
        updated: Date.now(),
        audioMeta: { ...previous.audioMeta, name, author, sync },
      };
    }, (_bytes, committed) => {
      version = committed;
    }, expectedVersion !== undefined);
    return { ok: ok && !conflict, ...(version ? { version } : {}), ...(conflict ? { conflict: true as const } : {}) };
  });
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
  const chosen = (await rawRecords().catch(() => [] as StoredDraftRecord[]))
    .filter((record) => !ids || ids.includes(record.id))
    .sort((a, b) => b.updated - a.updated);
  const saves: DraftSave[] = [];
  for (const raw of chosen) {
    const draft = opened(raw, await loadRecordAudio(raw));
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
  const taken = new Set((await rawRecords().catch(() => [] as StoredDraftRecord[])).map((d) => d.id));
  let loaded = 0;
  let broken = 0;
  for (const entry of entries) {
    const parsed = readSave(entry);
    if (!parsed) {
      broken++;
      continue;
    }
    const { record, audioPayload } = parsed;
    const fresh = taken.has(record.id) ? newDraftId() : record.id;
    taken.add(fresh);
    const mediaKey = record.audioMeta?.key;
    if (audioPayload && mediaKey) {
      try {
        await putMediaAudio(mediaKey, audioPayload);
      } catch (err) {
        draftFailed('draft import', err, 'put');
        throw new Error('draft import did not fit');
      }
    }
    let landed = false;
    const ok = await queueWrite(() =>
      updateDraft(fresh, 'draft import', () => ({ ...record, id: fresh }), () => {
        landed = true;
      }),
    );
    if (!ok || !landed) {
      if (mediaKey) {
        await deleteMediaAudio(mediaKey);
      }
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

/** One entry of either file shape as a record plus optional audio bytes, or null when it is not one. */
function readSave(entry: unknown): { record: StoredDraftRecord; audioPayload?: StoredBytes } | null {
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
  const record: StoredDraftRecord = {
    id,
    // Nothing was saved in the future: a card from the year 9999 is now.
    updated: Math.min(Date.now(), Number.isFinite(updated) ? updated : Number.isFinite(created) ? created : Date.now()),
    doc,
  };
  if (isDraftState(save.state)) {
    record.state = save.state;
  }
  let audioPayload: StoredBytes | undefined;
  try {
    if (typeof save.screenshot === 'string') {
      record.screenshotData = base64Bytes(save.screenshot, 'image/webp');
    }
    if (typeof save.audio === 'string') {
      const decoded = base64Bytes(save.audio, typeof save.audioType === 'string' ? save.audioType : 'audio/mpeg');
      audioPayload = decoded;
      const key = newDraftId();
      record.audioMeta = {
        key,
        name: typeof save.audioName === 'string' ? save.audioName : '',
        author: typeof save.audioAuthor === 'string' ? save.audioAuthor : '',
        sync: save.audioSync !== false,
        bytes: decoded.bytes.byteLength,
      };
    }
  } catch {
    return null; // base64 that is not base64
  }
  return { record, ...(audioPayload ? { audioPayload } : {}) };
}
