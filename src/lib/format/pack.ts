/**
 * The packed record of a document: the same JSON with every stroke's points
 * written as differences — the first pair as it is, each next one less the
 * pair before it. Short numbers that repeat are what brotli is good at: a
 * heavy toon goes from 3.2 MB of gzipped JSON to 371 KB (2026-10-17). It is
 * a way to send and keep a document, not a format: unpacking comes before
 * validation, and the canonical bytes and hash are those of the unpacked one.
 */

import type { ToonDocument } from './types';
import { FormatError } from './format-error';

/** The only packing there is; `packing` marks a packed record in its root. */
export const PACKING = 1;

export type PackedDocument = ToonDocument & { packing: typeof PACKING };

function mapPoints(doc: ToonDocument, points: (points: number[], path: string) => number[]): ToonDocument {
  return {
    ...doc,
    layers: doc.layers.map((layer, l) => ({
      ...layer,
      frames: layer.frames.map((frame, f) => ({
        ...frame,
        strokes: frame.strokes.map((stroke, s) => ({
          ...stroke,
          points: points(stroke.points, `/layers/${l}/frames/${f}/strokes/${s}/points`),
        })),
      })),
    })),
  };
}

export function packDocument(doc: ToonDocument): PackedDocument {
  const packed = mapPoints(doc, (points) => points.map((value, i) => (i < 2 ? value : value - points[i - 2])));
  return { ...packed, packing: PACKING };
}

/**
 * The document a packed record stands for; anything without `packing` comes
 * back as it is. Only what unpacking needs is checked here — the rest, sums
 * past int16 included, is the validator's.
 */
export function unpackDocument(data: unknown): unknown {
  if (typeof data !== 'object' || data === null || !('packing' in data)) {
    return data;
  }
  const { packing, ...doc } = data as PackedDocument;
  if (packing !== PACKING) {
    throw new FormatError([{ category: 'schema', path: '/packing', message: `unknown packing ${String(packing)}` }]);
  }
  return mapPoints(doc, (points, path) => {
    const out = points.slice();
    for (let i = 0; i < out.length; i++) {
      if (!Number.isInteger(out[i])) {
        throw new FormatError([{ category: 'schema', path: `${path}/${i}`, message: 'a difference must be an integer' }]);
      }
      if (i >= 2) {
        out[i] += out[i - 2];
      }
    }
    return out;
  });
}
