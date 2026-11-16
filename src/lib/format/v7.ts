/**
 * The one translation the format has: version 7 to version 8.
 *
 * Version 7 held a frame for `holds[i]` ticks in every layer at once. In
 * version 8 a cell is one tick, and a pause is the cells after a drawing that
 * continue it (`null`). So a column held for `n` ticks becomes its cell and
 * `n − 1` continuations in each layer — the film plays tick for tick and pixel
 * for pixel as it did. Nothing else changes.
 *
 * Drafts, `.toonop` files, the body of a toon in the site player and a toon
 * being continued all pass through here; the API takes version 8 only, and the
 * bodies already stored stay as they are (owner, 2026-11-17).
 *
 * There is no chain: a document of version 6 or older is not translated.
 */

import { MAX_HOLD } from './constants';
import { FormatError } from './format-error';

/**
 * Version 8 of a version 7 document, or the document itself when it is not
 * version 7. Takes a fresh tree; the translation is done in place. Throws
 * FormatError when the holds do not fit the frames — the same document the
 * version 7 validator refused.
 */
export function fromV7(data: unknown): unknown {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return data;
  const doc = data as Record<string, unknown>;
  if (doc.schema_version !== 7) return data;
  const layers = doc.layers;
  if (!Array.isArray(layers) || layers.length === 0) return data;
  const holds = doc.holds;
  delete doc.holds;
  doc.schema_version = 8;
  if (holds === undefined) return data;

  const frames = (layers[0] as { frames?: unknown })?.frames;
  const count = Array.isArray(frames) ? frames.length : 0;
  if (!Array.isArray(holds) || holds.length !== count) {
    refuse(`holds must have one entry per frame (${count})`);
  }
  if (!holds.every((hold) => Number.isInteger(hold) && hold >= 1 && hold <= MAX_HOLD)) {
    refuse(`a hold is a whole number of ticks 1–${MAX_HOLD}`);
  }
  if (holds.every((hold) => hold === 1)) {
    refuse('holds of one tick each are left out');
  }

  for (const layer of layers as { frames?: unknown }[]) {
    if (!Array.isArray(layer?.frames)) continue;
    const cells: unknown[] = [];
    layer.frames.forEach((frame, i) => {
      cells.push(frame);
      for (let t = 1; t < (holds[i] ?? 1); t++) cells.push(null);
    });
    layer.frames = cells;
  }
  return data;
}

function refuse(message: string): never {
  throw new FormatError([{ category: 'semantic', path: '/holds', message }]);
}
