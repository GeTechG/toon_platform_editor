import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalize } from './canonical';
import { packDocument, unpackDocument } from './pack';
import { FormatError } from './validate';
import type { ToonDocument } from './types';

const read = (path: string) => JSON.parse(readFileSync(join(import.meta.dir, path), 'utf8'));

function stroke(points: number[]): ToonDocument {
  return {
    schema_version: 7, width: 4800, height: 2400, frame_rate: 12,
    tools: [{ kind: 'pencil', geometry: 'smooth', width: 32, color: '#000000' }],
    layers: [{ hidden: false, frames: [{ strokes: [{ points, tool_id: 0 }] }] }],
  } as ToonDocument;
}

function rejection(data: unknown): FormatError {
  try {
    unpackDocument(data);
  } catch (error) {
    return error as FormatError;
  }
  throw new Error('unpacked without complaint');
}

describe('packed document', () => {
  it('writes each pair after the first as its difference from the previous pair', () => {
    const packed = packDocument(stroke([100, 200, 108, 196, 120, 196]));
    expect(packed.packing).toBe(1);
    expect(packed.layers[0].frames[0].strokes[0].points).toEqual([100, 200, 8, -4, 12, 0]);
  });

  it('leaves the document it packs alone', () => {
    const doc = stroke([100, 200, 108, 196]);
    packDocument(doc);
    expect(doc.layers[0].frames[0].strokes[0].points).toEqual([100, 200, 108, 196]);
    expect('packing' in doc).toBe(false);
  });

  for (const name of readdirSync(join(import.meta.dir, 'fixtures/packing'))) {
    it(`matches the shared fixture both ways: ${name}`, () => {
      const doc = read(`fixtures/valid/${name}`);
      const packed = read(`fixtures/packing/${name}`);
      expect(packDocument(doc)).toEqual(packed);
      expect(unpackDocument(packed)).toEqual(doc);
    });
  }

  for (const name of readdirSync(join(import.meta.dir, 'fixtures/valid')).filter((n) => !n.endsWith('.expected.json'))) {
    it(`unpacks to the same canonical bytes: ${name}`, () => {
      const doc = read(`fixtures/valid/${name}`);
      expect(canonicalize(unpackDocument(JSON.parse(JSON.stringify(packDocument(doc)))))).toBe(canonicalize(doc));
    });
  }

  it('returns a document without packing as it is', () => {
    const doc = stroke([100, 200, 108, 196]);
    expect(unpackDocument(doc)).toBe(doc);
  });

  it('refuses a packing it does not know', () => {
    const error = rejection({ ...stroke([1, 2]), packing: 2 });
    expect(error.issues).toEqual([expect.objectContaining({ category: 'schema', path: '/packing' })]);
  });

  it('refuses a difference that is not an integer', () => {
    const error = rejection({ ...stroke([100, 200, 0.5, 1]), packing: 1 });
    expect(error.issues).toEqual([
      expect.objectContaining({ category: 'schema', path: '/layers/0/frames/0/strokes/0/points/2' }),
    ]);
  });

  it('lets a sum past int16 through to the validator', () => {
    const doc = unpackDocument({ ...stroke([32000, 0, 1000, 0]), packing: 1 }) as ToonDocument;
    expect(doc.layers[0].frames[0].strokes[0].points).toEqual([32000, 0, 33000, 0]);
  });
});
