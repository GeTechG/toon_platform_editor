/**
 * Draft parsing: a stored draft goes through the same format validation and
 * version migration as any input document, so a record written by an older
 * editor still opens and a corrupt one is simply dropped from the list.
 * Kept pure and rune-free for tests.
 */

import { loadDocument, validateDocument } from '../format/validate';
import type { ToonDocument } from '../format/types';
import type { DraftAudio, DraftRecord } from './store';

/** The document held by a draft record, or null if it is not one. */
export function parseDraft(raw: unknown): ToonDocument | null {
  if (raw == null) {
    return null;
  }
  return validateDocument(raw).ok ? loadDocument(raw) : null;
}

/** A stored draft whose document loaded — what the drafts list shows. */
export interface DraftEntry {
  id: string;
  updated: number;
  doc: ToonDocument;
  /** The session's soundtrack, if it had one. */
  audio?: DraftAudio;
}

/** Loads every record that still parses; a corrupt one is dropped, not fatal. */
export function draftEntries(records: DraftRecord[]): DraftEntry[] {
  return records.flatMap((record) => {
    const doc = parseDraft(record.doc);
    return doc ? [{ id: record.id, updated: record.updated, doc, ...(record.audio ? { audio: record.audio } : {}) }] : [];
  });
}
