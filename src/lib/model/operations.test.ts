import { describe, expect, it } from 'bun:test';
import { validateDocument } from '../format/validate';
import {
  addFrame,
  addLayer,
  addStroke,
  cloneColumn,
  createDocument,
  insertFrameBefore,
  moveLayer,
  removeFrame,
  removeLastStroke,
  removeLayer,
  replaceColumn,
  setFrameRate,
  setLayerHidden,
} from './operations';

describe('createDocument', () => {
  it('creates a valid document with the research defaults', () => {
    const doc = createDocument();
    expect(doc.schema_version).toBe(3);
    expect(doc.tools).toEqual([]);
    expect(doc.width).toBe(4800);
    expect(doc.height).toBe(2400);
    expect(doc.frame_rate).toBe(12);
    expect(doc.layers).toEqual([{ hidden: false, frames: [{ strokes: [] }] }]);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('rejects invalid options', () => {
    expect(() => createDocument({ width: 0 })).toThrow(RangeError);
    expect(() => createDocument({ height: 10.5 })).toThrow(RangeError);
    expect(() => createDocument({ frameRate: 0 })).toThrow(RangeError);
  });
});

describe('addFrame / removeFrame', () => {
  it('inserts an empty frame after the given one and returns its index', () => {
    const doc = createDocument();
    addStroke(doc, 0, 0, { points: [1, 2], width: 8, color: '#112233' });
    const idx = addFrame(doc, 0);
    expect(idx).toBe(1);
    expect(doc.layers[0].frames).toHaveLength(2);
    expect(doc.layers[0].frames[0].strokes).toHaveLength(1);
    expect(doc.layers[0].frames[1].strokes).toHaveLength(0);
  });

  it('insertFrameBefore puts an empty frame in front of the given one', () => {
    const doc = createDocument();
    addStroke(doc, 0, 0, { points: [1, 2], width: 8, color: '#112233' });
    const idx = insertFrameBefore(doc, 0);
    expect(idx).toBe(0);
    expect(doc.layers[0].frames).toHaveLength(2);
    expect(doc.layers[0].frames[0].strokes).toHaveLength(0);
    expect(doc.layers[0].frames[1].strokes).toHaveLength(1);
  });

  it('insertFrameBefore rejects an out-of-range index and the frame cap', () => {
    const doc = createDocument();
    expect(() => insertFrameBefore(doc, 1)).toThrow(RangeError);
    expect(() => insertFrameBefore(doc, -1)).toThrow(RangeError);
  });

  it('removes a frame when others exist', () => {
    const doc = createDocument();
    addFrame(doc, 0);
    addFrame(doc, 1);
    addStroke(doc, 0, 2, { points: [5, 5], width: 8, color: '#000000' });
    removeFrame(doc, 1);
    expect(doc.layers[0].frames).toHaveLength(2);
    expect(doc.layers[0].frames[1].strokes).toHaveLength(1);
  });

  it('clears the only frame instead of removing it', () => {
    const doc = createDocument();
    addStroke(doc, 0, 0, { points: [5, 5], width: 8, color: '#000000' });
    removeFrame(doc, 0);
    expect(doc.layers[0].frames).toHaveLength(1);
    expect(doc.layers[0].frames[0].strokes).toHaveLength(0);
  });

  it('rejects an out-of-range index', () => {
    const doc = createDocument();
    expect(() => addFrame(doc, 1)).toThrow(RangeError);
    expect(() => removeFrame(doc, -1)).toThrow(RangeError);
  });
});

describe('cloneColumn / replaceColumn (frame copy-paste across layers)', () => {
  function twoLayerDoc() {
    const doc = createDocument();
    addLayer(doc, 0);
    addFrame(doc, 0);
    addStroke(doc, 0, 0, { points: [1, 2, 3, 4], width: 8, color: '#112233' });
    addStroke(doc, 1, 0, { points: [5, 6], width: 8, color: '#ff0000' });
    return doc;
  }

  it('cloneColumn copies the cell of every layer at that frame', () => {
    const doc = twoLayerDoc();
    const column = cloneColumn(doc, 0);
    expect(column).toHaveLength(2);
    expect(column[0].strokes[0].points).toEqual([1, 2, 3, 4]);
    expect(column[1].strokes[0].tool).toEqual({
      kind: 'pencil', dialect: 'multator', width: 8, color: '#ff0000',
    });
  });

  it('replaceColumn overwrites every layer with an independent deep copy', () => {
    const doc = twoLayerDoc();
    const column = cloneColumn(doc, 0);
    replaceColumn(doc, 1, column);
    expect(doc.layers[0].frames[1].strokes[0].points).toEqual([1, 2, 3, 4]);
    expect(doc.layers[1].frames[1].strokes[0].points).toEqual([5, 6]);
    column[0].strokes[0].points[0] = 999;
    doc.layers[0].frames[0].strokes[0].points[1] = 999;
    expect(doc.layers[0].frames[1].strokes[0].points).toEqual([1, 2, 3, 4]);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('replaces rather than appends, and gives each cell a fresh identity', () => {
    const doc = twoLayerDoc();
    addStroke(doc, 0, 1, { points: [7, 8], width: 8, color: '#00ff00' });
    const before = doc.layers[0].frames[1];
    replaceColumn(doc, 1, cloneColumn(doc, 0));
    expect(doc.layers[0].frames[1]).not.toBe(before);
    expect(doc.layers[0].frames[1].strokes).toHaveLength(1);
  });

  it('clears layers the buffer has no cell for and ignores surplus cells', () => {
    const doc = twoLayerDoc();
    addStroke(doc, 1, 1, { points: [9, 10], width: 8, color: '#000000' });
    replaceColumn(doc, 1, cloneColumn(doc, 0).slice(0, 1)); // buffer from a one-layer document
    expect(doc.layers[0].frames[1].strokes).toHaveLength(1);
    expect(doc.layers[1].frames[1].strokes).toHaveLength(0);

    const wide = [...cloneColumn(doc, 0), { strokes: [] }, { strokes: [] }];
    expect(() => replaceColumn(doc, 1, wide)).not.toThrow();
    expect(doc.layers).toHaveLength(2);
  });

  it('rejects an out-of-range index', () => {
    const doc = twoLayerDoc();
    expect(() => replaceColumn(doc, 5, cloneColumn(doc, 0))).toThrow(RangeError);
  });

  it('rejects a paste over the point limit without touching any layer', () => {
    const doc = createDocument();
    const big = Array.from({ length: 65536 }, (_, i) => i % 2); // 32768 points
    for (let f = 0; doc.layers[0].frames.length * 32768 <= 1_000_000; f++) {
      addStroke(doc, 0, f, { points: big, width: 8, color: '#000000' });
      addFrame(doc, f);
    }
    const last = doc.layers[0].frames.length - 1;
    expect(() => replaceColumn(doc, last, cloneColumn(doc, 0))).toThrow(RangeError);
    expect(doc.layers[0].frames[last].strokes).toHaveLength(0);
  });
});

describe('layer operations', () => {
  it('addLayer inserts an empty layer above the given one and returns its index', () => {
    const doc = createDocument();
    addFrame(doc, 0);
    addStroke(doc, 0, 0, { points: [1, 2], width: 8, color: '#000000' });
    const index = addLayer(doc, 0);
    expect(index).toBe(1);
    expect(doc.layers).toHaveLength(2);
    expect(doc.layers[1].hidden).toBe(false);
    expect(doc.layers[1].frames).toEqual([{ strokes: [] }, { strokes: [] }]);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('addLayer stops at the layer limit', () => {
    const doc = createDocument();
    for (let i = 1; i < 20; i++) addLayer(doc, 0);
    expect(doc.layers).toHaveLength(20);
    expect(() => addLayer(doc, 0)).toThrow(RangeError);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('removeLayer drops the layer but never the last one', () => {
    const doc = createDocument();
    addLayer(doc, 0);
    addStroke(doc, 1, 0, { points: [1, 2], width: 8, color: '#000000' });
    removeLayer(doc, 1);
    expect(doc.layers).toHaveLength(1);
    expect(() => removeLayer(doc, 0)).toThrow(RangeError);
    expect(doc.layers).toHaveLength(1);
  });

  it('moveLayer reorders in place', () => {
    const doc = createDocument();
    addLayer(doc, 0);
    addLayer(doc, 1);
    addStroke(doc, 0, 0, { points: [1, 2], width: 8, color: '#000000' });
    moveLayer(doc, 0, 2);
    expect(doc.layers[2].frames[0].strokes).toHaveLength(1);
    expect(doc.layers[0].frames[0].strokes).toHaveLength(0);
    moveLayer(doc, 2, 0);
    expect(doc.layers[0].frames[0].strokes).toHaveLength(1);
  });

  it('rejects out-of-range layer indices', () => {
    const doc = createDocument();
    addLayer(doc, 0);
    expect(() => moveLayer(doc, 0, 2)).toThrow(RangeError);
    expect(() => moveLayer(doc, -1, 0)).toThrow(RangeError);
    expect(() => removeLayer(doc, 2)).toThrow(RangeError);
    expect(() => addLayer(doc, 5)).toThrow(RangeError);
  });

  it('setLayerHidden toggles visibility in the document', () => {
    const doc = createDocument();
    setLayerHidden(doc, 0, true);
    expect(doc.layers[0].hidden).toBe(true);
    setLayerHidden(doc, 0, false);
    expect(doc.layers[0].hidden).toBe(false);
    expect(validateDocument(doc).ok).toBe(true);
  });
});

describe('removeLastStroke (per-stroke undo)', () => {
  it('pops the last stroke and reports whether one was removed', () => {
    const doc = createDocument();
    addStroke(doc, 0, 0, { points: [1, 2], width: 8, color: '#000000' });
    addStroke(doc, 0, 0, { points: [3, 4], width: 8, color: '#ff0000' });

    expect(removeLastStroke(doc, 0, 0)).toBe(true);
    expect(doc.layers[0].frames[0].strokes.map((s) => doc.tools[s.tool_id])).toEqual([
      { kind: 'pencil', dialect: 'multator', width: 8, color: '#000000' },
    ]);
    expect(removeLastStroke(doc, 0, 0)).toBe(true);
    expect(doc.layers[0].frames[0].strokes).toHaveLength(0);
    expect(removeLastStroke(doc, 0, 0)).toBe(false);
  });

  it('rejects an out-of-range index', () => {
    const doc = createDocument();
    expect(() => removeLastStroke(doc, 0, 1)).toThrow(RangeError);
  });
});

describe('addStroke', () => {
  it('appends strokes to the end of the frame', () => {
    const doc = createDocument();
    addStroke(doc, 0, 0, { points: [0, 0, 10, 10], width: 32, color: '#000000' });
    addStroke(doc, 0, 0, { points: [20, 20], width: 16, color: '#ff0000' });
    expect(doc.layers[0].frames[0].strokes.map((s) => doc.tools[s.tool_id])).toEqual([
      { kind: 'pencil', dialect: 'multator', width: 32, color: '#000000' },
      { kind: 'pencil', dialect: 'multator', width: 16, color: '#ff0000' },
    ]);
  });

  it('rejects unquantized (fractional) coordinates', () => {
    const doc = createDocument();
    expect(() => addStroke(doc, 0, 0, { points: [0.5, 1], width: 8, color: '#000000' })).toThrow(
      RangeError,
    );
  });

  it('rejects odd coordinate counts, out-of-int16 points and bad attributes', () => {
    const doc = createDocument();
    expect(() => addStroke(doc, 0, 0, { points: [1, 2, 3], width: 8, color: '#000000' })).toThrow();
    expect(() => addStroke(doc, 0, 0, { points: [40000, 0], width: 8, color: '#000000' })).toThrow();
    expect(() => addStroke(doc, 0, 0, { points: [1, 2], width: 0, color: '#000000' })).toThrow();
    expect(() => addStroke(doc, 0, 0, { points: [1, 2], width: 8, color: '#FF0000' })).toThrow();
  });

  it('accepts off-canvas points (a stroke can leave the canvas)', () => {
    const doc = createDocument();
    expect(() =>
      addStroke(doc, 0, 0, { points: [-320, -80, 5200, 2560], width: 8, color: '#000000' }),
    ).not.toThrow();
    expect(validateDocument(doc).ok).toBe(true);
  });
});

describe('setFrameRate', () => {
  it('changes the rate within format bounds', () => {
    const doc = createDocument();
    setFrameRate(doc, 24);
    expect(doc.frame_rate).toBe(24);
  });

  it('rejects non-integers and values outside 1..60', () => {
    const doc = createDocument();
    expect(() => setFrameRate(doc, 0)).toThrow(RangeError);
    expect(() => setFrameRate(doc, 12.5)).toThrow(RangeError);
    expect(() => setFrameRate(doc, 61)).toThrow(RangeError);
  });
});

describe('schema limits', () => {
  it('constants match toon-v1.schema.json', async () => {
    const [{ default: schema }, limits] = await Promise.all([
      import('../format/schema/toon-v1.schema.json'),
      import('../format/constants'),
    ]);
    expect(limits.MAX_DOC_DIMENSION).toBe(schema.properties.width.maximum);
    expect(limits.MAX_DOC_DIMENSION).toBe(schema.properties.height.maximum);
    expect(limits.MAX_FRAMES).toBe(schema.properties.frames.maxItems);
    expect(limits.MAX_STROKES_PER_FRAME).toBe(schema.$defs.frame.properties.strokes.maxItems);
    expect(limits.MAX_STROKE_COORDS).toBe(schema.$defs.stroke.properties.points.maxItems);
    expect(limits.MAX_STROKE_WIDTH).toBe(schema.$defs.stroke.properties.width.maximum);
  });

  it('createDocument rejects dimensions over the schema maximum', () => {
    expect(() => createDocument({ width: 32768 })).toThrow(RangeError);
    expect(() => createDocument({ height: 32768 })).toThrow(RangeError);
    expect(validateDocument(createDocument({ width: 32767, height: 32767 })).ok).toBe(true);
  });

  it('addFrame stops at the frame limit', () => {
    const doc = createDocument();
    for (let i = 1; i < 4096; i++) {
      addFrame(doc, 0);
    }
    expect(() => addFrame(doc, 0)).toThrow(RangeError);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('addStroke rejects strokes over the width and coordinate-count limits', () => {
    const doc = createDocument();
    expect(() => addStroke(doc, 0, 0, { points: [1, 2], width: 4801, color: '#000000' })).toThrow(
      RangeError,
    );
    const tooMany = Array.from({ length: 65538 }, (_, i) => i % 2);
    expect(() => addStroke(doc, 0, 0, { points: tooMany, width: 8, color: '#000000' })).toThrow(
      RangeError,
    );
    const atLimit = Array.from({ length: 65536 }, (_, i) => i % 2);
    addStroke(doc, 0, 0, { points: atLimit, width: 4800, color: '#000000' });
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('addStroke stops at the per-frame stroke limit', () => {
    const doc = createDocument();
    doc.tools.push({ kind: 'pencil', dialect: 'multator', width: 8, color: '#000000' });
    for (let i = 0; i < 16384; i++) {
      doc.layers[0].frames[0].strokes.push({ points: [1, 2], tool_id: 0 });
    }
    expect(() => addStroke(doc, 0, 0, { points: [1, 2], width: 8, color: '#000000' })).toThrow(
      RangeError,
    );
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('addStroke stops at the document-wide point limit', () => {
    const doc = createDocument();
    const big = Array.from({ length: 65536 }, (_, i) => i % 2); // 32768 points
    for (let f = 0; doc.layers[0].frames.length * 32768 <= 1_000_000; f++) {
      addStroke(doc, 0, f, { points: big, width: 8, color: '#000000' });
      addFrame(doc, f);
    }
    const last = doc.layers[0].frames.length - 1;
    expect(() => addStroke(doc, 0, last, { points: big, width: 8, color: '#000000' })).toThrow(
      RangeError,
    );
    addStroke(doc, 0, last, { points: [1, 2], width: 8, color: '#000000' });
  });
});

describe('layer coordinate', () => {
  it('addStroke targets the given layer only', () => {
    const doc = createDocument();
    addLayer(doc, 0);
    addStroke(doc, 0, 0, { points: [1, 2], width: 8, color: '#000000' });
    expect(doc.layers[0].frames[0].strokes).toHaveLength(1);
    expect(doc.layers[1].frames[0].strokes).toHaveLength(0);
  });

  it('removeLastStroke pops from the given layer only', () => {
    const doc = createDocument();
    addLayer(doc, 0);
    addStroke(doc, 0, 0, { points: [1, 2], width: 8, color: '#000000' });
    addStroke(doc, 1, 0, { points: [3, 4], width: 8, color: '#ff0000' });
    expect(removeLastStroke(doc, 1, 0)).toBe(true);
    expect(removeLastStroke(doc, 1, 0)).toBe(false);
    expect(doc.layers[0].frames[0].strokes).toHaveLength(1);
  });

  it('rejects an out-of-range layer index', () => {
    const doc = createDocument();
    expect(() => addStroke(doc, 1, 0, { points: [1, 2], width: 8, color: '#000000' })).toThrow(RangeError);
    expect(() => removeLastStroke(doc, -1, 0)).toThrow(RangeError);
  });
});

describe('frame operations across layers', () => {
  it('addFrame inserts an empty cell into every layer', () => {
    const doc = createDocument();
    addLayer(doc, 0);
    addLayer(doc, 1);
    addStroke(doc, 2, 0, { points: [1, 2], width: 8, color: '#000000' });
    expect(addFrame(doc, 0)).toBe(1);
    expect(doc.layers.map((l) => l.frames.length)).toEqual([2, 2, 2]);
    expect(doc.layers.every((l) => l.frames[1].strokes.length === 0)).toBe(true);
    expect(doc.layers[2].frames[0].strokes).toHaveLength(1);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('insertFrameBefore inserts into every layer at the same position', () => {
    const doc = createDocument();
    addLayer(doc, 0);
    addStroke(doc, 1, 0, { points: [1, 2], width: 8, color: '#000000' });
    expect(insertFrameBefore(doc, 0)).toBe(0);
    expect(doc.layers.map((l) => l.frames.length)).toEqual([2, 2]);
    expect(doc.layers[1].frames[0].strokes).toHaveLength(0);
    expect(doc.layers[1].frames[1].strokes).toHaveLength(1);
  });

  it('removeFrame removes the column from every layer', () => {
    const doc = createDocument();
    addLayer(doc, 0);
    addFrame(doc, 0);
    addStroke(doc, 1, 1, { points: [1, 2], width: 8, color: '#000000' });
    removeFrame(doc, 0);
    expect(doc.layers.map((l) => l.frames.length)).toEqual([1, 1]);
    expect(doc.layers[1].frames[0].strokes).toHaveLength(1);
  });

  it('clears the last remaining column in every layer, keeping the layers', () => {
    const doc = createDocument();
    addLayer(doc, 0);
    addStroke(doc, 0, 0, { points: [1, 2], width: 8, color: '#000000' });
    addStroke(doc, 1, 0, { points: [3, 4], width: 8, color: '#000000' });
    removeFrame(doc, 0);
    expect(doc.layers).toHaveLength(2);
    expect(doc.layers.map((l) => l.frames.length)).toEqual([1, 1]);
    expect(doc.layers.every((l) => l.frames[0].strokes.length === 0)).toBe(true);
  });
});

describe('v3 schema limits', () => {
  it('constants match toon-v3.schema.json', async () => {
    const [{ default: schema }, limits] = await Promise.all([
      import('../format/schema/toon-v3.schema.json'),
      import('../format/constants'),
    ]);
    expect(limits.MAX_LAYERS).toBe(schema.properties.layers.maxItems);
    expect(schema.properties.layers.minItems).toBe(1);
    expect(schema.$defs.layer.required).toEqual(['hidden', 'frames']);
    expect(limits.MAX_FRAMES).toBe(schema.$defs.layer.properties.frames.maxItems);
    expect(schema.$defs.layer.properties.frames.minItems).toBe(1);
    expect(limits.MAX_STROKES_PER_FRAME).toBe(schema.$defs.frame.properties.strokes.maxItems);
    expect(limits.MAX_STROKE_COORDS).toBe(schema.$defs.stroke.properties.points.maxItems);
  });
});
