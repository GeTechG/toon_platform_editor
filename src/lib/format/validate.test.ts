import { describe, expect, it } from 'bun:test';
import { createDocument } from '../model/operations';
import { FormatError, loadDocument, validateDocument } from './validate';

function validDoc(): unknown {
  return {
    schema_version: 1,
    width: 4800,
    height: 2400,
    frame_rate: 12,
    frames: [{ strokes: [{ points: [10, 20, 30, 40], width: 32, color: '#000000' }] }],
  };
}

describe('validateDocument', () => {
  it('accepts a valid document (including one built by operations)', () => {
    expect(validateDocument(validDoc())).toEqual({ ok: true, issues: [] });
    expect(validateDocument(createDocument())).toEqual({ ok: true, issues: [] });
  });

  it('rejects an unknown (higher) schema_version without interpreting content', () => {
    const doc = { ...(validDoc() as object), schema_version: 99, junk: true };
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].category).toBe('unsupported-version');
    expect(result.issues[0].path).toBe('/schema_version');
    expect(result.issues[0].message).toContain('not supported');
  });

  it('rejects a non-object document', () => {
    for (const bad of [null, [], 'str', 42]) {
      const result = validateDocument(bad);
      expect(result.ok).toBe(false);
      expect(result.issues[0].category).toBe('schema');
    }
  });

  it('rejects a fractional coordinate with a path to the value', () => {
    const doc = validDoc() as { frames: { strokes: { points: number[] }[] }[] };
    doc.frames[0].strokes[0].points[2] = 30.5;
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    expect(
      result.issues.some(
        (i) => i.category === 'schema' && i.path === '/frames/0/strokes/0/points/2',
      ),
    ).toBe(true);
  });

  it('accepts off-canvas coordinates (a stroke can leave the canvas)', () => {
    const doc = validDoc() as { frames: { strokes: { points: number[] }[] }[] };
    doc.frames[0].strokes[0].points[0] = -500; // x < 0
    doc.frames[0].strokes[0].points[1] = 2401; // y > height
    expect(validateDocument(doc)).toEqual({ ok: true, issues: [] });
  });

  it('rejects a coordinate outside the int16 range (schema) with a path', () => {
    const doc = validDoc() as { frames: { strokes: { points: number[] }[] }[] };
    doc.frames[0].strokes[0].points[1] = 40000;
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    expect(
      result.issues.some(
        (i) => i.category === 'schema' && i.path === '/frames/0/strokes/0/points/1',
      ),
    ).toBe(true);
  });

  it('rejects an odd coordinate count (semantic)', () => {
    const doc = validDoc() as { frames: { strokes: { points: number[] }[] }[] };
    doc.frames[0].strokes[0].points = [10, 20, 30];
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    expect(result.issues[0].category).toBe('semantic');
    expect(result.issues[0].path).toBe('/frames/0/strokes/0/points');
  });

  it('rejects a non-integer coordinate in an in-memory document (semantic)', () => {
    // Impossible to write in JSON (the schema catches it), but an object
    // built in memory bypassing operations can — the semantic layer guards.
    const doc = validDoc() as { frames: { strokes: { points: number[] }[] }[] };
    doc.frames[0].strokes[0].points = [10, 20, 30, Number.NaN];
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
  });

  it('accepts an eraser stroke (erase: true) and rejects erase: false', () => {
    const doc = validDoc() as { frames: { strokes: { erase?: unknown }[] }[] };
    doc.frames[0].strokes[0].erase = true;
    expect(validateDocument(doc)).toEqual({ ok: true, issues: [] });
    doc.frames[0].strokes[0].erase = false;
    expect(validateDocument(doc).ok).toBe(false);
  });

  it('rejects extra and missing properties (schema)', () => {
    const extra = { ...(validDoc() as object), layers: [] };
    expect(validateDocument(extra).ok).toBe(false);
    const missing = validDoc() as Record<string, unknown>;
    delete missing.frames;
    const result = validateDocument(missing);
    expect(result.ok).toBe(false);
    expect(result.issues.every((i) => i.category === 'schema')).toBe(true);
  });
});

describe('loadDocument', () => {
  it('returns a typed document for valid JSON', () => {
    const doc = loadDocument(validDoc());
    expect(doc.schema_version).toBe(2);
    expect(doc.tools).toEqual([
      { kind: 'pencil', dialect: 'multator', width: 32, color: '#000000' },
    ]);
    expect(doc.frames).toHaveLength(1);
  });

  it('migrates a legacy white stroke (#ffffff, no flag) to an eraser stroke', () => {
    const legacy = validDoc() as { frames: { strokes: { color: string; erase?: true }[] }[] };
    legacy.frames[0].strokes[0].color = '#ffffff';
    const doc = loadDocument(legacy);
    expect(doc.tools[doc.frames[0].strokes[0].tool_id]).toEqual({
      kind: 'eraser', dialect: 'multator', width: 32,
    });
  });

  it('leaves non-white strokes untouched (no erase flag added)', () => {
    const doc = loadDocument(validDoc());
    expect(doc.tools[doc.frames[0].strokes[0].tool_id].kind).toBe('pencil');
  });

  it('throws FormatError with the issue list for invalid input', () => {
    expect(() => loadDocument({ schema_version: 3 })).toThrow(FormatError);
    try {
      loadDocument({ schema_version: 3 });
    } catch (e) {
      expect((e as FormatError).issues[0].category).toBe('unsupported-version');
    }
  });
});
