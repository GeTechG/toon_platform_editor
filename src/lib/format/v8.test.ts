import { describe, expect, it } from 'bun:test';
import { MAX_SUPPORTED_SCHEMA_VERSION, SCHEMA_VERSION } from './constants';
import { SQUARE_STAMP } from './types';
import { loadDocument, validateDocument } from './validate';

const doc = (tools: unknown[], version = 8, points = [0, 0, 64, 0]): unknown => ({
  schema_version: version,
  width: 4800,
  height: 2400,
  frame_rate: 12,
  tools,
  layers: [{ hidden: false, frames: [{ strokes: [{ points, tool_id: 0 }] }] }],
});

const PENCIL = { kind: 'pencil', geometry: 'smooth', width: 64, color: '#0026ff' };

describe('schema version 8 — geometry instead of dialect', () => {
  it('is the version the editor writes', () => {
    expect(SCHEMA_VERSION).toBe(8);
    expect(MAX_SUPPORTED_SCHEMA_VERSION).toBe(8);
  });

  it('takes a descriptor that says how its points are read', () => {
    expect(validateDocument(doc([PENCIL])).ok).toBe(true);
    expect(validateDocument(doc([{ ...PENCIL, geometry: 'line' }])).ok).toBe(true);
    expect(validateDocument(doc([{ ...PENCIL, geometry: 'cubic' }], 8, [0, 0, 8, 0, 16, 8, 16, 16])).ok)
      .toBe(true);
  });

  it('refuses a descriptor that names an application instead of a geometry', () => {
    expect(validateDocument(doc([{ kind: 'pencil', dialect: 'multator', width: 64, color: '#0026ff' }])).ok)
      .toBe(false);
    expect(validateDocument(doc([{ ...PENCIL, geometry: 'toonio' }])).ok).toBe(false);
  });

  it('wants a cubic stroke to carry whole segments', () => {
    const cubic = { ...PENCIL, geometry: 'cubic' };
    expect(validateDocument(doc([cubic], 8, [0, 0, 8, 0, 16, 8, 16, 16])).ok).toBe(true);
    expect(validateDocument(doc([cubic], 8, [0, 0, 8, 0, 16, 8])).ok).toBe(false);
    expect(validateDocument(doc([cubic], 8, [0, 0])).ok).toBe(true);
  });

  it('lets the stamp keep its shape and read its points as places', () => {
    const stamp = { kind: 'stamp', geometry: 'line', width: 64, color: '#0026ff', shape: [...SQUARE_STAMP] };
    expect(validateDocument(doc([stamp])).ok).toBe(true);
    expect(validateDocument(doc([{ ...stamp, geometry: 'smooth' }])).ok).toBe(false);
  });

  it('rejects every version but the last one before it', () => {
    for (const version of [1, 2, 3, 4, 5, 6, 9]) {
      const result = validateDocument(doc([PENCIL], version));
      expect(result.ok).toBe(false);
      expect(result.issues[0].category).toBe('unsupported-version');
    }
  });
});

const cells = (...frames: unknown[]): unknown => ({
  schema_version: 8,
  width: 4800,
  height: 2400,
  frame_rate: 12,
  tools: [PENCIL],
  layers: [{ hidden: false, frames }],
});
const A = { strokes: [{ points: [0, 0, 64, 0], tool_id: 0 }] };

describe('a continuation cell', () => {
  it('is null and shows the drawing before it', () => {
    expect(validateDocument(cells(A, null, null)).ok).toBe(true);
  });

  it('cannot open a layer: empty from the start is an empty drawing', () => {
    const result = validateDocument(cells(null, A));
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({ category: 'semantic', path: '/layers/0/frames/0' });
  });

  it('leaves no room for holds', () => {
    expect(validateDocument({ ...(cells(A, A) as object), holds: [1, 2] }).ok).toBe(false);
  });
});

describe('a version 7 document', () => {
  const v7 = (holds?: number[]): unknown => ({
    schema_version: 7,
    width: 4800,
    height: 2400,
    frame_rate: 12,
    tools: [PENCIL],
    layers: [
      { hidden: false, frames: [A, { strokes: [] }, A] },
      { hidden: true, name: 'Фон', frames: [{ strokes: [] }, A, { strokes: [] }] },
    ],
    ...(holds ? { holds } : {}),
  });

  it('is not version 8 to the validator', () => {
    expect(validateDocument(v7()).issues[0].category).toBe('unsupported-version');
  });

  it('opens as version 8, its pauses unrolled into continuations in every layer', () => {
    const doc = loadDocument(v7([1, 3, 1]));
    expect(doc.schema_version).toBe(8);
    expect('holds' in doc).toBe(false);
    expect(doc.layers[0].frames).toEqual([A, { strokes: [] }, null, null, A]);
    expect(doc.layers[1].frames).toEqual([{ strokes: [] }, A, null, null, { strokes: [] }]);
    expect(doc.layers[1].name).toBe('Фон');
  });

  it('opens cell for cell without holds', () => {
    expect(loadDocument(v7()).layers[0].frames).toEqual([A, { strokes: [] }, A]);
  });

  it('is refused when its holds do not fit its frames', () => {
    expect(() => loadDocument(v7([1, 2]))).toThrow();
    expect(() => loadDocument(v7([1, 1, 1]))).toThrow();
    expect(() => loadDocument(v7([1, 0, 1]))).toThrow();
    expect(() => loadDocument(v7([1, 100, 1]))).toThrow();
  });
});

describe('a version 7 document longer than the format once unrolled', () => {
  it('is refused with the schema ceiling named, not cut short', () => {
    const empty = { strokes: [] };
    const long = {
      schema_version: 7, width: 4800, height: 2400, frame_rate: 12, tools: [],
      layers: [{ hidden: false, frames: Array.from({ length: 1011 }, () => empty) }],
      holds: Array.from({ length: 1011 }, () => 99),
    };
    expect(() => loadDocument(long)).toThrow(/100000/);
  });
});
