import { describe, expect, it } from 'bun:test';
import type { ToonDocumentV3, ToonDocumentV4 } from './types';
import { migrateV3ToV4 } from './upgrade';
import { validateDocument } from './validate';

const v4 = (tools: unknown[]): unknown => ({
  schema_version: 4,
  width: 4800,
  height: 2400,
  frame_rate: 12,
  tools,
  layers: [{ hidden: false, frames: [{ strokes: [{ points: [0, 0, 8, 8], tool_id: 0 }] }] }],
});

const FEATHER = { kind: 'feather', dialect: 'toonio', width: 40, color: '#000000', fill: '#ff0000' };
const PIXEL = { kind: 'pixel', dialect: 'toonio', width: 64, color: '#0026ff' };

describe('schema version 4', () => {
  it('accepts the feather and pixel tools', () => {
    expect(validateDocument(v4([FEATHER, PIXEL])).ok).toBe(true);
  });

  it('rejects a feather without a fill color', () => {
    const { kind, dialect, width, color } = FEATHER;
    const result = validateDocument(v4([{ kind, dialect, width, color }]));
    expect(result.ok).toBe(false);
    expect(result.issues[0].category).toBe('schema');
  });

  it('rejects a pixel carrying a fill color', () => {
    expect(validateDocument(v4([{ ...PIXEL, fill: '#ff0000' }])).ok).toBe(false);
  });

  it('rejects the Multator dialect for both — they are Tonio tools', () => {
    expect(validateDocument(v4([{ ...FEATHER, dialect: 'multator' }])).ok).toBe(false);
    expect(validateDocument(v4([{ ...PIXEL, dialect: 'multator' }])).ok).toBe(false);
  });

  it('keeps the new tools out of version 3', () => {
    expect(validateDocument({ ...(v4([FEATHER]) as object), schema_version: 3 }).ok).toBe(false);
  });
});

describe('v3 → v4 migration', () => {
  it('only lifts the version — layers, strokes and tools are untouched', () => {
    const doc: ToonDocumentV3 = {
      schema_version: 3,
      width: 4800,
      height: 2400,
      frame_rate: 12,
      tools: [{ kind: 'pencil', dialect: 'multator', width: 32, color: '#000000' }],
      layers: [{ hidden: false, frames: [{ strokes: [{ points: [0, 0, 8, 8], tool_id: 0 }] }] }],
    };
    const upgraded: ToonDocumentV4 = migrateV3ToV4(structuredClone(doc));
    expect(upgraded).toEqual({ ...doc, schema_version: 4 } as ToonDocumentV4);
  });
});
