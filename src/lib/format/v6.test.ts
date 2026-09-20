import { describe, expect, it } from 'bun:test';
import { MAX_SUPPORTED_SCHEMA_VERSION, SCHEMA_VERSION } from './constants';
import schemaV6 from './schema/toon-v6.schema.json';
import { SQUARE_STAMP, type ToonDocumentV5 } from './types';
import { migrateV5ToV6 } from './upgrade';
import { loadDocument, validateDocument } from './validate';

const PIXEL = { kind: 'pixel', dialect: 'toonio', width: 64, color: '#0026ff' };
const STAMP = { ...PIXEL, kind: 'stamp', shape: [...SQUARE_STAMP] };

const doc = (tools: unknown[], version = 6): unknown => ({
  schema_version: version,
  width: 4800,
  height: 2400,
  frame_rate: 12,
  tools,
  layers: [{ hidden: false, frames: [{ strokes: [{ points: [0, 0, 64, 0], tool_id: 0 }] }] }],
});

describe('schema version 6', () => {
  it('is the version the editor writes', () => {
    expect(SCHEMA_VERSION).toBe(6);
    expect(MAX_SUPPORTED_SCHEMA_VERSION).toBe(6);
  });

  it('has the stamp in place of the pixel', () => {
    expect(Object.keys(schemaV6.$defs)).toContain('stamp');
    expect(Object.keys(schemaV6.$defs)).not.toContain('pixel');
    expect(validateDocument(doc([STAMP])).ok).toBe(true);
    // The pixel belongs to v5 and earlier; v6 knows only the general stamp.
    expect(validateDocument(doc([PIXEL])).ok).toBe(false);
  });

  it('wants a polygon of at least three points, on the unit square', () => {
    expect(validateDocument(doc([{ ...STAMP, shape: [0, 0, 1, 1] }])).ok).toBe(false);
    expect(validateDocument(doc([{ ...STAMP, shape: [0, 0, 2, 0, 1, 1] }])).ok).toBe(false);
    expect(validateDocument(doc([{ ...STAMP, shape: [0, 0, 1, 0, 0.5, 1] }])).ok).toBe(true);
  });

  it('turns a v5 pixel into the stamp of the unit square, leaving the rest alone', () => {
    const v5 = doc([PIXEL, { kind: 'pencil', dialect: 'multator', width: 32, color: '#000000' }], 5);

    const migrated = migrateV5ToV6(v5 as ToonDocumentV5);

    expect(migrated.schema_version).toBe(6);
    expect(migrated.tools[0]).toEqual(STAMP as never);
    // Everything else is untouched: the squares land exactly where they did.
    expect(migrated.tools[1]).toEqual({ kind: 'pencil', dialect: 'multator', width: 32, color: '#000000' } as never);
    expect(migrated.layers).toEqual((v5 as ToonDocumentV5).layers);
  });

  it('loads a v5 publication straight into v6', () => {
    const loaded = loadDocument(doc([PIXEL], 5));

    expect(loaded.schema_version).toBe(6);
    expect(loaded.tools[0]).toEqual(STAMP as never);
  });
});
