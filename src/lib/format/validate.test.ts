import { describe, expect, it } from 'bun:test';
import { createDocument } from '../model/operations';
import { FormatError, loadDocument, validateDocument } from './validate';

function validDoc(): unknown {
  return {
    schema_version: 7,
    width: 4800,
    height: 2400,
    frame_rate: 12,
    tools: [{ kind: 'pencil', geometry: 'smooth', width: 32, color: '#000000' }],
    layers: [{ hidden: false, frames: [{ strokes: [{ points: [10, 20, 30, 40], tool_id: 0 }] }] }],
  };
}

/** The same document with one stroke's points replaced. */
function docWithPoints(points: number[]): unknown {
  const doc = validDoc() as { layers: { frames: { strokes: { points: number[] }[] }[] }[] };
  doc.layers[0].frames[0].strokes[0].points = points;
  return doc;
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
    const doc = docWithPoints([10, 20, 30.5, 40]);
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    expect(
      result.issues.some(
        (i) => i.category === 'schema' && i.path === '/layers/0/frames/0/strokes/0/points/2',
      ),
    ).toBe(true);
  });

  it('accepts off-canvas coordinates (a stroke can leave the canvas)', () => {
    expect(validateDocument(docWithPoints([-500, 2401, 30, 40]))).toEqual({ ok: true, issues: [] });
  });

  it('rejects a coordinate outside the int16 range (schema) with a path', () => {
    const result = validateDocument(docWithPoints([10, 40000, 30, 40]));
    expect(result.ok).toBe(false);
    expect(
      result.issues.some(
        (i) => i.category === 'schema' && i.path === '/layers/0/frames/0/strokes/0/points/1',
      ),
    ).toBe(true);
  });

  it('rejects an odd coordinate count (semantic)', () => {
    const result = validateDocument(docWithPoints([10, 20, 30]));
    expect(result.ok).toBe(false);
    expect(result.issues[0].category).toBe('semantic');
    expect(result.issues[0].path).toBe('/layers/0/frames/0/strokes/0/points');
  });

  it('rejects a non-integer coordinate in an in-memory document (semantic)', () => {
    // Impossible to write in JSON (the schema catches it), but an object
    // built in memory bypassing operations can — the semantic layer guards.
    const result = validateDocument(docWithPoints([10, 20, 30, Number.NaN]));
    expect(result.ok).toBe(false);
  });

  it('rejects extra and missing properties (schema)', () => {
    const extra = { ...(validDoc() as object), frames: [] };
    expect(validateDocument(extra).ok).toBe(false);
    const missing = validDoc() as Record<string, unknown>;
    delete missing.layers;
    const result = validateDocument(missing);
    expect(result.ok).toBe(false);
    expect(result.issues.every((i) => i.category === 'schema')).toBe(true);
  });
});

describe('loadDocument', () => {
  it('returns a typed document for valid JSON', () => {
    const doc = loadDocument(validDoc());
    expect(doc.schema_version).toBe(7);
    expect(doc.tools).toEqual([
      { kind: 'pencil', geometry: 'smooth', width: 32, color: '#000000' },
    ]);
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0].frames).toHaveLength(1);
  });

  it('throws FormatError with the issue list for invalid input', () => {
    expect(() => loadDocument({ schema_version: 8 })).toThrow(FormatError);
    try {
      loadDocument({ schema_version: 8 });
    } catch (e) {
      expect((e as FormatError).issues[0].category).toBe('unsupported-version');
    }
  });
});

function layeredDoc(layers = 2, frames = 2): Record<string, unknown> {
  return {
    schema_version: 7,
    width: 4800,
    height: 2400,
    frame_rate: 12,
    tools: [{ kind: 'pencil', geometry: 'smooth', width: 32, color: '#000000' }],
    layers: Array.from({ length: layers }, () => ({
      hidden: false,
      frames: Array.from({ length: frames }, () => ({ strokes: [] })),
    })),
  };
}

describe('validateDocument: layers', () => {
  it('accepts a multi-layer document with a hidden layer', () => {
    const doc = layeredDoc(3, 5) as { layers: { hidden: boolean }[] };
    doc.layers[1].hidden = true;
    expect(validateDocument(doc)).toEqual({ ok: true, issues: [] });
  });

  it('rejects layers of unequal length as semantic, with a path to the layer', () => {
    const doc = layeredDoc(2, 5) as { layers: { frames: unknown[] }[] };
    doc.layers[1].frames.pop();
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ category: 'semantic', path: '/layers/1/frames' }),
    );
  });

  it('rejects a tool_id outside the table in any layer', () => {
    const doc = layeredDoc(2, 2) as { layers: { frames: { strokes: unknown[] }[] }[] };
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
    const result = validateDocument(layeredDoc(21, 1));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.category === 'schema')).toBe(true);
  });

  it('rejects a layer without the hidden flag as a schema violation', () => {
    const doc = layeredDoc(1, 1) as { layers: Record<string, unknown>[] };
    delete doc.layers[0].hidden;
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.category === 'schema')).toBe(true);
  });

  it('takes a layer name and refuses any other extra property', () => {
    const named = layeredDoc(1, 1) as { layers: Record<string, unknown>[] };
    named.layers[0].name = 'Фон';
    expect(validateDocument(named).ok).toBe(true);
    const odd = layeredDoc(1, 1) as { layers: Record<string, unknown>[] };
    odd.layers[0].locked = true;
    expect(validateDocument(odd).ok).toBe(false);
  });

  it('rejects schema_version above the supported maximum', () => {
    const result = validateDocument({ ...(layeredDoc() as object), schema_version: 8 });
    expect(result.issues[0].category).toBe('unsupported-version');
  });
});

describe('cross-language parity: number spelling', () => {
  it('accepts an integer spelled as a float — JSON.parse erases the difference', () => {
    // `1e2` and `100` are the same JSON number, so both spellings are valid.
    const doc = JSON.parse('{"schema_version":7,"width":1e2,"height":2400,"frame_rate":12,"tools":[],"layers":[{"hidden":false,"frames":[{"strokes":[]}]}]}');
    expect(Number.isInteger(doc.width)).toBe(true);
    expect(validateDocument(doc).ok).toBe(true);
  });
});

describe('stroke pressure', () => {
  function withPressure(pressure: unknown, points = [10, 20, 30, 40]): unknown {
    const doc = docWithPoints(points) as { layers: { frames: { strokes: Record<string, unknown>[] }[] }[] };
    doc.layers[0].frames[0].strokes[0].pressure = pressure;
    return doc;
  }

  it('accepts one integer 0–100 per point', () => {
    expect(validateDocument(withPressure([0, 100]))).toEqual({ ok: true, issues: [] });
  });

  it('rejects a pressure array whose length is not the point count', () => {
    const result = validateDocument(withPressure([20, 90], [0, 0, 1, 1, 2, 2]));
    expect(result.ok).toBe(false);
    expect(result.issues[0].path).toBe('/layers/0/frames/0/strokes/0/pressure');
  });

  it('rejects a value outside 0–100 or a fraction', () => {
    expect(validateDocument(withPressure([20, 101])).ok).toBe(false);
    expect(validateDocument(withPressure([20, 0.5])).ok).toBe(false);
  });
});

it('a document with pressure survives the .toonop and draft round-trip (JSON and back)', () => {
  const doc = validDoc() as { layers: { frames: { strokes: Record<string, unknown>[] }[] }[] };
  doc.layers[0].frames[0].strokes[0].pressure = [5, 95];
  expect(loadDocument(JSON.parse(JSON.stringify(doc))).layers[0].frames[0].strokes[0].pressure).toEqual([5, 95]);
});
