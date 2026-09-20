import { describe, expect, it } from 'bun:test';
import { MAX_LAYER_NAME } from './constants';
import { canonicalize } from './canonical';
import { sha256Hex } from './hash';
import schemaV5 from './schema/toon-v5.schema.json';
import type { ToonDocumentV4 } from './types';
import { migrateV4ToV5 } from './upgrade';
import { loadDocument, validateDocument } from './validate';

const v5 = (layer: Record<string, unknown>): unknown => ({
  schema_version: 6,
  width: 4800,
  height: 2400,
  frame_rate: 12,
  tools: [{ kind: 'pencil', dialect: 'multator', width: 32, color: '#000000' }],
  layers: [{ hidden: false, frames: [{ strokes: [{ points: [0, 0, 8, 8], tool_id: 0 }] }], ...layer }],
});

describe('schema version 5', () => {
  it('caps a layer name at the reference MAX_LAYER_NAME', () => {
    expect(MAX_LAYER_NAME).toBe(12);
    expect(schemaV5.$defs.layer.properties.name.maxLength).toBe(MAX_LAYER_NAME);
  });

  it('accepts a layer without a name', () => {
    expect(validateDocument(v5({})).ok).toBe(true);
  });

  it('accepts a named layer', () => {
    expect(validateDocument(v5({ name: 'Фон' })).ok).toBe(true);
  });

  it('accepts a name of exactly 12 characters', () => {
    expect(validateDocument(v5({ name: 'а'.repeat(MAX_LAYER_NAME) })).ok).toBe(true);
  });

  it('rejects an empty name', () => {
    const result = validateDocument(v5({ name: '' }));
    expect(result.ok).toBe(false);
    expect(result.issues[0].category).toBe('schema');
  });

  it('rejects a name of 13 characters', () => {
    const result = validateDocument(v5({ name: 'а'.repeat(MAX_LAYER_NAME + 1) }));
    expect(result.ok).toBe(false);
    expect(result.issues[0].category).toBe('schema');
  });

  it('rejects any other extra layer property', () => {
    expect(validateDocument(v5({ colour: 3 })).ok).toBe(false);
  });

  it('keeps the layer name out of version 4', () => {
    const doc = v5({ name: 'Фон' }) as Record<string, unknown>;
    expect(validateDocument({ ...doc, schema_version: 4 }).ok).toBe(false);
  });
});

describe('v4 → v5 migration', () => {
  const v4: ToonDocumentV4 = {
    schema_version: 4,
    width: 4800,
    height: 2400,
    frame_rate: 12,
    tools: [{ kind: 'pencil', dialect: 'multator', width: 32, color: '#000000' }],
    layers: [
      { hidden: false, frames: [{ strokes: [{ points: [0, 0, 8, 8], tool_id: 0 }] }] },
      { hidden: true, frames: [{ strokes: [] }] },
    ],
  };

  it('only lifts the version — no layer gains a name', () => {
    expect(migrateV4ToV5(structuredClone(v4))).toEqual({ ...v4, schema_version: 5 } as never);
  });

  it('loadDocument lifts a v4 document to v5 without touching its content', () => {
    const doc = loadDocument(structuredClone(v4));
    expect(doc.schema_version).toBe(6);
    expect(doc.layers).toEqual(v4.layers as never);
  });

  it('leaves the canonical bytes of the content untouched — only schema_version moves', () => {
    const before = canonicalize(v4);
    const after = canonicalize(migrateV4ToV5(structuredClone(v4)));
    expect(after).toBe(before.replace('"schema_version":4', '"schema_version":5'));
  });

  it('hashes a v4 document the same before and after the version is masked out', async () => {
    const mask = (doc: unknown) => canonicalize({ ...(doc as object), schema_version: 0 });
    expect(await sha256Hex(mask(v4))).toBe(await sha256Hex(mask(migrateV4ToV5(structuredClone(v4)))));
  });
});

describe('canonical serialization of a layer name', () => {
  it('includes name, sorted among the layer keys', () => {
    expect(canonicalize({ hidden: false, name: 'Фон', frames: [] })).toBe(
      '{"frames":[],"hidden":false,"name":"Фон"}',
    );
  });

  it('gives two layers differing only by name different hashes', async () => {
    const a = canonicalize({ hidden: false, name: 'Фон', frames: [] });
    const b = canonicalize({ hidden: false, name: 'Свет', frames: [] });
    expect(await sha256Hex(a)).not.toBe(await sha256Hex(b));
  });
});
