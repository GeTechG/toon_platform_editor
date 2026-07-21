/**
 * Draft-restore decision: a restored draft goes through the same format
 * validation as any input document, and only replaces the in-memory
 * document if the user has not started editing yet (avoids clobbering
 * fresh work with a slow async load). Kept pure and rune-free for tests.
 */

import { loadDocument, validateDocument } from '../format/validate';
import type { ToonDocumentV2 } from '../format/types';

/** The document to restore, or null to keep the fresh document. */
export function decideRestore(raw: unknown, touched: boolean): ToonDocumentV2 | null {
  if (raw == null || touched) {
    return null;
  }
  return validateDocument(raw).ok ? loadDocument(raw) : null;
}
