/**
 * Draft parsing: a stored draft goes through the same format validation and
 * version migration as any input document, so a record written by an older
 * editor still opens and a corrupt one is simply dropped from the list.
 * Kept pure and rune-free for tests.
 */

import { loadDocument } from '../format/validate';
import type { ToonDocument } from '../format/types';

/** The document held by a draft record, or null if it is not one. */
export function parseDraft(
  raw: unknown,
  /** The tree was just read out of the base and nobody else holds it: no copy. */
  owned = false,
): ToonDocument | null {
  if (raw == null) {
    return null;
  }
  // `loadDocument` validates on its own: checking first went over a heavy
  // document twice.
  try {
    return loadDocument(raw, { owned });
  } catch {
    return null;
  }
}
