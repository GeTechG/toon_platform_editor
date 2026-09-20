import { describe, expect, it } from 'bun:test';
import { createDocument } from '../model/operations';
import { FormatError, loadDocument, migrateV2ToV3, validateDocument } from './validate';

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
    expect(doc.schema_version).toBe(6);
    expect(doc.tools).toEqual([
      { kind: 'pencil', dialect: 'multator', width: 32, color: '#000000' },
    ]);
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0].frames).toHaveLength(1);
  });

  it('migrates a legacy white stroke (#ffffff, no flag) to an eraser stroke', () => {
    const legacy = validDoc() as { frames: { strokes: { color: string; erase?: true }[] }[] };
    legacy.frames[0].strokes[0].color = '#ffffff';
    const doc = loadDocument(legacy);
    expect(doc.tools[doc.layers[0].frames[0].strokes[0].tool_id]).toEqual({
      kind: 'eraser', dialect: 'multator', width: 32,
    });
  });

  it('leaves non-white strokes untouched (no erase flag added)', () => {
    const doc = loadDocument(validDoc());
    expect(doc.tools[doc.layers[0].frames[0].strokes[0].tool_id].kind).toBe('pencil');
  });

  it('throws FormatError with the issue list for invalid input', () => {
    expect(() => loadDocument({ schema_version: 7 })).toThrow(FormatError);
    try {
      loadDocument({ schema_version: 7 });
    } catch (e) {
      expect((e as FormatError).issues[0].category).toBe('unsupported-version');
    }
  });
});

function v2Doc(): unknown {
  return {
    schema_version: 2,
    width: 4800,
    height: 2400,
    frame_rate: 12,
    tools: [{ kind: 'pencil', dialect: 'multator', width: 32, color: '#000000' }],
    frames: [{ strokes: [{ points: [10, 20, 30, 40], tool_id: 0 }] }, { strokes: [] }],
  };
}

function v3Doc(layers = 2, frames = 2): Record<string, unknown> {
  return {
    schema_version: 3,
    width: 4800,
    height: 2400,
    frame_rate: 12,
    tools: [{ kind: 'pencil', dialect: 'multator', width: 32, color: '#000000' }],
    layers: Array.from({ length: layers }, () => ({
      hidden: false,
      frames: Array.from({ length: frames }, () => ({ strokes: [] })),
    })),
  };
}

describe('validateDocument: v3 layers', () => {
  it('accepts a multi-layer document with a hidden layer', () => {
    const doc = v3Doc(3, 5) as { layers: { hidden: boolean }[] };
    doc.layers[1].hidden = true;
    expect(validateDocument(doc)).toEqual({ ok: true, issues: [] });
  });

  it('rejects layers of unequal length as semantic, with a path to the layer', () => {
    const doc = v3Doc(2, 5) as { layers: { frames: unknown[] }[] };
    doc.layers[1].frames.pop();
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ category: 'semantic', path: '/layers/1/frames' }),
    );
  });

  it('rejects a tool_id outside the table in any layer', () => {
    const doc = v3Doc(2, 2) as { layers: { frames: { strokes: unknown[] }[] }[] };
    doc.layers[1].frames[0].strokes.push({ points: [1, 2], tool_id: 7 });
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        category: 'semantic',
        path: '/layers/1/frames/0/strokes/0/tool_id',
      }),
    );
  });

  it('rejects more than 20 layers as a schema violation', () => {
    const result = validateDocument(v3Doc(21, 1));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.category === 'schema')).toBe(true);
  });

  it('rejects a layer without the hidden flag as a schema violation', () => {
    const doc = v3Doc(1, 1) as { layers: Record<string, unknown>[] };
    delete doc.layers[0].hidden;
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.category === 'schema')).toBe(true);
  });

  it('rejects a layer carrying an extra property (no names in the format)', () => {
    const doc = v3Doc(1, 1) as { layers: Record<string, unknown>[] };
    doc.layers[0].name = 'Фон';
    expect(validateDocument(doc).ok).toBe(false);
  });

  it('rejects schema_version above the supported maximum', () => {
    const result = validateDocument({ ...(v3Doc() as object), schema_version: 7 });
    expect(result.issues[0].category).toBe('unsupported-version');
  });
});

describe('migrateV2ToV3', () => {
  it('moves frames into one visible layer, leaving strokes and tools untouched', () => {
    const source = v2Doc() as import('./types').ToonDocumentV2;
    const doc = migrateV2ToV3(source);
    expect(doc.schema_version).toBe(3);
    expect(doc.tools).toEqual(source.tools);
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0].hidden).toBe(false);
    expect(doc.layers[0].frames).toEqual(source.frames);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('does not share stroke arrays with the source document', () => {
    const source = v2Doc() as import('./types').ToonDocumentV2;
    const doc = migrateV2ToV3(source);
    doc.layers[0].frames[0].strokes[0].points[0] = 999;
    expect(source.frames[0].strokes[0].points[0]).toBe(10);
  });
});

describe('loadDocument: version chain', () => {
  it('migrates v2 through to v6', () => {
    const doc = loadDocument(v2Doc());
    expect(doc.schema_version).toBe(6);
    expect(doc.layers[0].frames).toHaveLength(2);
  });

  it('lifts a v3 document to v6 without touching its content (deep copy)', () => {
    const source = v3Doc(2, 3);
    const doc = loadDocument(source);
    expect(doc).toEqual({ ...(source as object), schema_version: 6 } as never);
    expect(doc.layers).not.toBe((source as { layers: unknown }).layers);
  });
});

describe('the feather dialect by schema version', () => {
  const feather = (version: number, dialect: string) => ({
    schema_version: version,
    width: 4800,
    height: 2400,
    frame_rate: 12,
    tools: [{ kind: 'feather', dialect, width: 40, color: '#000000', fill: '#ff0000' }],
    layers: [{ hidden: false, frames: [{ strokes: [{ points: [0, 0, 8, 8], tool_id: 0 }] }] }],
  });

  it('v5 takes a Multator feather — a preset is the algorithm', () => {
    expect(validateDocument(feather(5, 'multator')).ok).toBe(true);
    expect(validateDocument(feather(5, 'toonio')).ok).toBe(true);
  });

  it('v4 still refuses it: there the feather was Tonio-dialect only', () => {
    const result = validateDocument(feather(4, 'multator'));
    expect(result.ok).toBe(false);
    expect(result.issues[0].category).toBe('schema');
  });
});

describe('cross-language parity: number spelling', () => {
  it('accepts an integer spelled as a float — JSON.parse erases the difference', () => {
    // `1e2` and `100` are the same JSON number, so both spellings are valid.
    const doc = JSON.parse('{"schema_version":3,"width":1e2,"height":2400,"frame_rate":12,"tools":[],"layers":[{"hidden":false,"frames":[{"strokes":[]}]}]}');
    expect(Number.isInteger(doc.width)).toBe(true);
    expect(validateDocument(doc).ok).toBe(true);
  });
});
