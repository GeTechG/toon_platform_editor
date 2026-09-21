import { describe, expect, it } from 'bun:test';
import { MAX_SUPPORTED_SCHEMA_VERSION, SCHEMA_VERSION } from './constants';
import { SQUARE_STAMP } from './types';
import { validateDocument } from './validate';

const doc = (tools: unknown[], version = 7, points = [0, 0, 64, 0]): unknown => ({
  schema_version: version,
  width: 4800,
  height: 2400,
  frame_rate: 12,
  tools,
  layers: [{ hidden: false, frames: [{ strokes: [{ points, tool_id: 0 }] }] }],
});

const PENCIL = { kind: 'pencil', geometry: 'smooth', width: 64, color: '#0026ff' };

describe('schema version 7 — geometry instead of dialect', () => {
  it('is the only version the editor writes and reads', () => {
    expect(SCHEMA_VERSION).toBe(7);
    expect(MAX_SUPPORTED_SCHEMA_VERSION).toBe(7);
  });

  it('takes a descriptor that says how its points are read', () => {
    expect(validateDocument(doc([PENCIL])).ok).toBe(true);
    expect(validateDocument(doc([{ ...PENCIL, geometry: 'line' }])).ok).toBe(true);
    expect(validateDocument(doc([{ ...PENCIL, geometry: 'cubic' }], 7, [0, 0, 8, 0, 16, 8, 16, 16])).ok)
      .toBe(true);
  });

  it('refuses a descriptor that names an application instead of a geometry', () => {
    expect(validateDocument(doc([{ kind: 'pencil', dialect: 'multator', width: 64, color: '#0026ff' }])).ok)
      .toBe(false);
    expect(validateDocument(doc([{ ...PENCIL, geometry: 'toonio' }])).ok).toBe(false);
  });

  it('wants a cubic stroke to carry whole segments', () => {
    const cubic = { ...PENCIL, geometry: 'cubic' };
    expect(validateDocument(doc([cubic], 7, [0, 0, 8, 0, 16, 8, 16, 16])).ok).toBe(true);
    expect(validateDocument(doc([cubic], 7, [0, 0, 8, 0, 16, 8])).ok).toBe(false);
    expect(validateDocument(doc([cubic], 7, [0, 0])).ok).toBe(true);
  });

  it('lets the stamp keep its shape and read its points as places', () => {
    const stamp = { kind: 'stamp', geometry: 'line', width: 64, color: '#0026ff', shape: [...SQUARE_STAMP] };
    expect(validateDocument(doc([stamp])).ok).toBe(true);
    expect(validateDocument(doc([{ ...stamp, geometry: 'smooth' }])).ok).toBe(false);
  });

  it('rejects every older version instead of migrating it', () => {
    for (const version of [1, 2, 3, 4, 5, 6]) {
      const result = validateDocument(doc([PENCIL], version));
      expect(result.ok).toBe(false);
      expect(result.issues[0].category).toBe('unsupported-version');
    }
  });
});
