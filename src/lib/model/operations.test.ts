import { describe, expect, it } from 'bun:test';
import { SQUARE_STAMP } from '../format/types';
import { validateDocument } from '../format/validate';
import {
  addFrame,
  addLayer,
  addStroke,
  cloneColumn,
  copyCells,
  createDocument,
  mergeCells,
  insertFrameBefore,
  internTool,
  isEmptyDocument,
  moveLayer,
  removeFrame,
  removeLastStroke,
  pasteNeedsConfirm,
  removeLayer,
  renameLayer,
  replaceCells,
  replaceColumn,
  setFrameRate,
  setLayerHidden,
  replaceStrokes,
  transformStrokes,
  mirrorCell,
} from './operations';
import { transformMatrix } from './geom';

describe('createDocument', () => {
  it('creates a valid document with the research defaults', () => {
    const doc = createDocument();
    expect(doc.schema_version).toBe(6);
    expect(doc.tools).toEqual([]);
    expect(doc.width).toBe(10240);
    expect(doc.height).toBe(5760);
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
    addLayer(doc, 1);
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
  it('addLayer inserts an empty layer at the given index and returns it', () => {
    const doc = createDocument();
    addFrame(doc, 0);
    addStroke(doc, 0, 0, { points: [1, 2], width: 8, color: '#000000' });
    const index = addLayer(doc, 1);
    expect(index).toBe(1);
    expect(doc.layers).toHaveLength(2);
    expect(doc.layers[1].hidden).toBe(false);
    expect(doc.layers[1].frames).toEqual([{ strokes: [] }, { strokes: [] }]);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('addLayer can slide a layer in underneath the bottom one', () => {
    const doc = createDocument();
    addStroke(doc, 0, 0, { points: [1, 2], width: 8, color: '#000000' });
    expect(addLayer(doc, 0)).toBe(0);
    expect(doc.layers[0].frames[0].strokes).toHaveLength(0);
    expect(doc.layers[1].frames[0].strokes).toHaveLength(1);
  });

  it('addLayer takes the index one past the top — the new top layer', () => {
    const doc = createDocument();
    expect(addLayer(doc, 1)).toBe(1);
    expect(() => addLayer(doc, 3)).toThrow(RangeError);
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
    addLayer(doc, 1);
    addStroke(doc, 1, 0, { points: [1, 2], width: 8, color: '#000000' });
    removeLayer(doc, 1);
    expect(doc.layers).toHaveLength(1);
    expect(() => removeLayer(doc, 0)).toThrow(RangeError);
    expect(doc.layers).toHaveLength(1);
  });

  it('moveLayer reorders in place', () => {
    const doc = createDocument();
    addLayer(doc, 1);
    addLayer(doc, 2);
    addStroke(doc, 0, 0, { points: [1, 2], width: 8, color: '#000000' });
    moveLayer(doc, 0, 2);
    expect(doc.layers[2].frames[0].strokes).toHaveLength(1);
    expect(doc.layers[0].frames[0].strokes).toHaveLength(0);
    moveLayer(doc, 2, 0);
    expect(doc.layers[0].frames[0].strokes).toHaveLength(1);
  });

  it('rejects out-of-range layer indices', () => {
    const doc = createDocument();
    addLayer(doc, 1);
    expect(() => moveLayer(doc, 0, 2)).toThrow(RangeError);
    expect(() => moveLayer(doc, -1, 0)).toThrow(RangeError);
    expect(() => removeLayer(doc, 2)).toThrow(RangeError);
    expect(() => addLayer(doc, 6)).toThrow(RangeError);
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
    addLayer(doc, 1);
    addStroke(doc, 0, 0, { points: [1, 2], width: 8, color: '#000000' });
    expect(doc.layers[0].frames[0].strokes).toHaveLength(1);
    expect(doc.layers[1].frames[0].strokes).toHaveLength(0);
  });

  it('removeLastStroke pops from the given layer only', () => {
    const doc = createDocument();
    addLayer(doc, 1);
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
    addLayer(doc, 1);
    addLayer(doc, 2);
    addStroke(doc, 2, 0, { points: [1, 2], width: 8, color: '#000000' });
    expect(addFrame(doc, 0)).toBe(1);
    expect(doc.layers.map((l) => l.frames.length)).toEqual([2, 2, 2]);
    expect(doc.layers.every((l) => l.frames[1].strokes.length === 0)).toBe(true);
    expect(doc.layers[2].frames[0].strokes).toHaveLength(1);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('insertFrameBefore inserts into every layer at the same position', () => {
    const doc = createDocument();
    addLayer(doc, 1);
    addStroke(doc, 1, 0, { points: [1, 2], width: 8, color: '#000000' });
    expect(insertFrameBefore(doc, 0)).toBe(0);
    expect(doc.layers.map((l) => l.frames.length)).toEqual([2, 2]);
    expect(doc.layers[1].frames[0].strokes).toHaveLength(0);
    expect(doc.layers[1].frames[1].strokes).toHaveLength(1);
  });

  it('removeFrame removes the column from every layer', () => {
    const doc = createDocument();
    addLayer(doc, 1);
    addFrame(doc, 0);
    addStroke(doc, 1, 1, { points: [1, 2], width: 8, color: '#000000' });
    removeFrame(doc, 0);
    expect(doc.layers.map((l) => l.frames.length)).toEqual([1, 1]);
    expect(doc.layers[1].frames[0].strokes).toHaveLength(1);
  });

  it('clears the last remaining column in every layer, keeping the layers', () => {
    const doc = createDocument();
    addLayer(doc, 1);
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

describe('replaceStrokes (mega eraser)', () => {
  it('swaps a cell contents, leaving the tool table and other cells alone', () => {
    const doc = createDocument();
    addStroke(doc, 0, 0, { points: [0, 0, 8, 8], width: 8, color: '#000000' });
    replaceStrokes(doc, 0, 0, [
      { points: [0, 0, 4, 4], tool_id: 0 },
      { points: [16, 16, 24, 24], tool_id: 0 },
    ]);
    expect(doc.layers[0].frames[0].strokes).toEqual([
      { points: [0, 0, 4, 4], tool_id: 0 },
      { points: [16, 16, 24, 24], tool_id: 0 },
    ]);
    expect(doc.tools).toHaveLength(1);
  });

  it('refuses a stroke pointing at a tool the document does not have', () => {
    const doc = createDocument();
    expect(() => replaceStrokes(doc, 0, 0, [{ points: [0, 0], tool_id: 7 }])).toThrow(RangeError);
  });

  it('refuses fractional coordinates', () => {
    const doc = createDocument();
    addStroke(doc, 0, 0, { points: [0, 0, 8, 8], width: 8, color: '#000000' });
    expect(() => replaceStrokes(doc, 0, 0, [{ points: [0, 0.5], tool_id: 0 }])).toThrow(RangeError);
  });
});


describe('copyCells / replaceCells / mergeCells (timeline block copy-paste)', () => {
  /** Two layers × three frames, each cell holding one stroke tagged by its coordinates. */
  function grid(): ReturnType<typeof createDocument> {
    const doc = createDocument();
    addLayer(doc, 1);
    addFrame(doc, 0);
    addFrame(doc, 1);
    for (let l = 0; l < 2; l++) {
      for (let f = 0; f < 3; f++) {
        addStroke(doc, l, f, { points: [l * 8, f * 8], width: 8, color: '#112233' });
      }
    }
    return doc;
  }

  const at = (doc: ReturnType<typeof createDocument>, l: number, f: number) =>
    doc.layers[l].frames[f].strokes.map((s) => s.points);

  it('copies the selected block, layers then frames, with the tools resolved', () => {
    const doc = grid();
    const buffer = copyCells(doc, { frames: [1, 2], layers: [0, 1] });
    expect(buffer).toHaveLength(2);
    expect(buffer[0]).toHaveLength(2);
    expect(buffer[0][0].strokes[0].points).toEqual([0, 8]);
    expect(buffer[1][1].strokes[0].points).toEqual([8, 16]);
    expect(buffer[0][0].strokes[0].tool.kind).toBe('pencil');
  });

  it('the copy is deep — drawing on the source afterwards leaves the buffer alone', () => {
    const doc = grid();
    const buffer = copyCells(doc, { frames: [0], layers: [0] });
    addStroke(doc, 0, 0, { points: [99, 99], width: 8, color: '#000000' });
    expect(buffer[0][0].strokes).toHaveLength(1);
  });

  it('replaceCells overwrites the target cells and returns what was there', () => {
    const doc = grid();
    const buffer = copyCells(doc, { frames: [0], layers: [0] });
    const before = replaceCells(doc, { frames: [2], layers: [1] }, buffer);
    expect(at(doc, 1, 2)).toEqual([[0, 0]]);
    expect(before[0][0].strokes[0].points).toEqual([8, 16]);
  });

  it('mergeCells keeps the old strokes and appends the buffer on top', () => {
    const doc = grid();
    const buffer = copyCells(doc, { frames: [0], layers: [0] });
    mergeCells(doc, { frames: [2], layers: [1] }, buffer);
    expect(at(doc, 1, 2)).toEqual([[8, 16], [0, 0]]);
  });

  it('the block hangs from the top: the buffer keeps its layer order under the target top', () => {
    const doc = grid();
    // The whole two-layer column of frame 0, dropped so its top row lands on
    // layer 1 — the target's top — and its bottom row on layer 0.
    const buffer = copyCells(doc, { frames: [0], layers: [0, 1] });
    replaceCells(doc, { frames: [2], layers: [0, 1] }, buffer);
    expect(at(doc, 1, 2)).toEqual([[8, 0]]);
    expect(at(doc, 0, 2)).toEqual([[0, 0]]);
  });

  it('a target shorter than the buffer keeps the buffer top and drops its bottom', () => {
    const doc = grid();
    const buffer = copyCells(doc, { frames: [0, 1, 2], layers: [0, 1] });
    replaceCells(doc, { frames: [2], layers: [1] }, buffer);
    // Layer 1 of the buffer is its top row, frame 0 its first — the corner.
    expect(at(doc, 1, 2)).toEqual([[8, 0]]);
  });

  it('a non-contiguous layer selection copies and pastes only those layers', () => {
    const doc = grid();
    addLayer(doc, 2);
    addStroke(doc, 2, 0, { points: [16, 0], width: 8, color: '#112233' });
    const buffer = copyCells(doc, { frames: [0], layers: [0, 2] });
    expect(buffer).toHaveLength(2);
    expect(buffer[1][0].strokes[0].points).toEqual([16, 0]);
  });

  it('rejects a cell outside the document', () => {
    const doc = grid();
    expect(() => copyCells(doc, { frames: [3], layers: [0] })).toThrow(RangeError);
    expect(() => copyCells(doc, { frames: [0], layers: [9] })).toThrow(RangeError);
  });

  it('repeats a short buffer over the target frames, cycling by f % buffer', () => {
    const doc = grid();
    addFrame(doc, 2);
    addFrame(doc, 3);
    // Two frames of layer 0 ([0,0] and [0,8]) over the five frames 0..4.
    const buffer = copyCells(doc, { frames: [0, 1], layers: [0] });
    replaceCells(doc, { frames: [0, 1, 2, 3, 4], layers: [0] }, buffer);
    expect([0, 1, 2, 3, 4].map((f) => at(doc, 0, f))).toEqual([
      [[0, 0]],
      [[0, 8]],
      [[0, 0]],
      [[0, 8]],
      [[0, 0]],
    ]);
  });

  it('a repeated merge does not double the strokes it already laid down', () => {
    const doc = grid();
    const buffer = copyCells(doc, { frames: [0], layers: [0] });
    mergeCells(doc, { frames: [2], layers: [1] }, buffer);
    mergeCells(doc, { frames: [2], layers: [1] }, buffer);
    expect(at(doc, 1, 2)).toEqual([[8, 16], [0, 0]]);
  });

  it('merges a buffer whose strokes differ from the cell tail', () => {
    const doc = grid();
    const buffer = copyCells(doc, { frames: [0], layers: [0] });
    mergeCells(doc, { frames: [2], layers: [1] }, buffer);
    const other = copyCells(doc, { frames: [1], layers: [0] });
    mergeCells(doc, { frames: [2], layers: [1] }, other);
    expect(at(doc, 1, 2)).toEqual([[8, 16], [0, 0], [0, 8]]);
  });

  it('a same-shaped stroke drawn with another tool is not the tail', () => {
    const doc = grid();
    const buffer = copyCells(doc, { frames: [0], layers: [0] });
    mergeCells(doc, { frames: [2], layers: [1] }, buffer);
    const recoloured: typeof buffer = [[{
      strokes: [{ points: [0, 0], tool: { kind: 'pencil', dialect: 'multator', width: 8, color: '#ff0000' } }],
    }]];
    mergeCells(doc, { frames: [2], layers: [1] }, recoloured);
    expect(at(doc, 1, 2)).toEqual([[8, 16], [0, 0], [0, 0]]);
  });

  it('cycles the buffer through mergeCells too', () => {
    const doc = grid();
    const buffer = copyCells(doc, { frames: [0], layers: [0] });
    mergeCells(doc, { frames: [1, 2], layers: [0] }, buffer);
    expect(at(doc, 0, 1)).toEqual([[0, 8], [0, 0]]);
    expect(at(doc, 0, 2)).toEqual([[0, 16], [0, 0]]);
  });
});

describe('transformStrokes and the pixel grid', () => {
  /** Cells of `width` laid edge to edge from the origin. */
  function pixelRow(width: number, cells: number) {
    const doc = createDocument({ width: 4000, height: 4000 });
    addStroke(doc, 0, 0, {
      points: Array.from({ length: cells * 2 }, (_, i) => (i % 2 ? 0 : (i / 2) * width)),
      tool: { kind: 'stamp', dialect: 'toonio', width, color: '#000000', shape: [...SQUARE_STAMP] },
    });
    return doc;
  }

  /** Distance between consecutive cells along x. */
  function steps(points: readonly number[]): number[] {
    const out: number[] = [];
    for (let i = 2; i < points.length; i += 2) {
      out.push(points[i] - points[i - 2]);
    }
    return out;
  }

  it('puts the scaled cells back on the grid, so drawing over them lines up', () => {
    const doc = pixelRow(20, 6);
    transformStrokes(doc, 0, 0, null, transformMatrix({ scaleX: 1.2, scaleY: 1.2 }, 50, 50), 1.2);
    const points = doc.layers[0].frames[0].strokes[0].points;
    expect(points.every((v) => v % 24 === 0)).toBe(true);
  });

  it('keeps the cells edge to edge when the width follows the scale', () => {
    // A pixel cell is drawn as a square of the tool width from its top-left
    // corner, so the row only stays solid while the gap equals that width.
    // Snapping the scaled points back onto the global grid breaks exactly
    // this: neighbours collapse onto one cell and the row grows holes.
    const doc = pixelRow(20, 6);
    transformStrokes(doc, 0, 0, null, transformMatrix({ scaleX: 1.2, scaleY: 1.2 }, 50, 50), 1.2);
    const stroke = doc.layers[0].frames[0].strokes[0];
    const tool = doc.tools[stroke.tool_id];
    expect(tool.kind === 'stamp' && tool.width).toBe(24);
    expect(steps(stroke.points)).toEqual([24, 24, 24, 24, 24]);
  });

  it('leaves an ordinary stroke exactly where the matrix put it', () => {
    const doc = createDocument({ width: 100, height: 100 });
    addStroke(doc, 0, 0, {
      points: [0, 0, 10, 10],
      tool: { kind: 'pencil', dialect: 'toonio', width: 10, color: '#000000' },
    });
    transformStrokes(doc, 0, 0, null, transformMatrix({ scaleX: 1.5, scaleY: 1.5 }, 0, 0));
    expect(doc.layers[0].frames[0].strokes[0].points).toEqual([0, 0, 15, 15]);
  });
});

describe('transformStrokes', () => {
  const cell = (doc: ReturnType<typeof createDocument>) => doc.layers[0].frames[0];

  function withStrokes(...widths: number[]) {
    const doc = createDocument({ width: 100, height: 100 });
    widths.forEach((width, i) => {
      addStroke(doc, 0, 0, {
        points: [10 + i, 20 + i, 30 + i, 40 + i],
        tool: { kind: 'pencil', dialect: 'toonio', width, color: '#000000' },
      });
    });
    return doc;
  }

  it('moves only the named strokes', () => {
    const doc = withStrokes(5, 5);
    transformStrokes(doc, 0, 0, [1], transformMatrix({ dx: 7, dy: -3 }, 50, 50));
    expect(cell(doc).strokes[0].points).toEqual([10, 20, 30, 40]);
    expect(cell(doc).strokes[1].points).toEqual([18, 18, 38, 38]);
  });

  it('a null index list transforms the whole cell', () => {
    const doc = withStrokes(5, 5);
    transformStrokes(doc, 0, 0, null, transformMatrix({ dx: 1, dy: 1 }, 50, 50));
    expect(cell(doc).strokes[0].points).toEqual([11, 21, 31, 41]);
    expect(cell(doc).strokes[1].points).toEqual([12, 22, 32, 42]);
  });

  it('leaves whole coordinates inside the stored range', () => {
    const doc = withStrokes(5);
    transformStrokes(doc, 0, 0, null, transformMatrix({ rotate: 33, scaleX: 1e6 }, 50, 50));
    for (const coord of cell(doc).strokes[0].points) {
      expect(Number.isInteger(coord)).toBe(true);
      expect(coord).toBeGreaterThanOrEqual(-32768);
      expect(coord).toBeLessThanOrEqual(32767);
    }
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('scales the tool width when asked, and keeps the descriptor otherwise', () => {
    const doc = withStrokes(5);
    transformStrokes(doc, 0, 0, null, transformMatrix({ scaleX: 2, scaleY: 2 }, 50, 50), 2);
    const tool = doc.tools[cell(doc).strokes[0].tool_id];
    expect(tool).toMatchObject({ kind: 'pencil', width: 10, color: '#000000' });
  });

  it('a width scale of 1 reuses the tool it already had', () => {
    const doc = withStrokes(5);
    const before = cell(doc).strokes[0].tool_id;
    transformStrokes(doc, 0, 0, null, transformMatrix({ dx: 5 }, 50, 50), 1);
    expect(cell(doc).strokes[0].tool_id).toBe(before);
    expect(doc.tools).toHaveLength(1);
  });

  it('clamps a scaled width to the format range instead of writing an invalid tool', () => {
    const doc = withStrokes(5);
    transformStrokes(doc, 0, 0, null, transformMatrix({}, 50, 50), 1e6);
    expect(doc.tools[cell(doc).strokes[0].tool_id]).toMatchObject({ width: 4800 });
    transformStrokes(doc, 0, 0, null, transformMatrix({}, 50, 50), 1e-6);
    expect(doc.tools[cell(doc).strokes[0].tool_id]).toMatchObject({ width: 1 });
  });

  it('ignores an index that is not in the cell', () => {
    const doc = withStrokes(5);
    transformStrokes(doc, 0, 0, [4], transformMatrix({ dx: 9 }, 50, 50));
    expect(cell(doc).strokes[0].points).toEqual([10, 20, 30, 40]);
  });
});

describe('mirrorCell', () => {
  function oneStroke() {
    const doc = createDocument({ width: 100, height: 100 });
    addStroke(doc, 0, 0, {
      points: [10, 20, 30, 40],
      tool: { kind: 'pencil', dialect: 'toonio', width: 5, color: '#000000' },
    });
    return doc;
  }

  it('flips horizontally about the canvas centre', () => {
    const doc = oneStroke();
    mirrorCell(doc, 0, 0, 'horizontal');
    expect(doc.layers[0].frames[0].strokes[0].points).toEqual([90, 20, 70, 40]);
  });

  it('flips vertically about the canvas centre', () => {
    const doc = oneStroke();
    mirrorCell(doc, 0, 0, 'vertical');
    expect(doc.layers[0].frames[0].strokes[0].points).toEqual([10, 80, 30, 60]);
  });

  it('mirroring twice is the identity', () => {
    const doc = oneStroke();
    mirrorCell(doc, 0, 0, 'horizontal');
    mirrorCell(doc, 0, 0, 'horizontal');
    expect(doc.layers[0].frames[0].strokes[0].points).toEqual([10, 20, 30, 40]);
  });
});


describe('renameLayer', () => {
  const doc = () => {
    const d = createDocument();
    addLayer(d, 0);
    return d;
  };

  it('stores the name on the layer', () => {
    const d = doc();
    renameLayer(d, 1, 'Фон');
    expect(d.layers[1].name).toBe('Фон');
    expect(d.layers[0].name).toBeUndefined();
  });

  it('trims surrounding whitespace', () => {
    const d = doc();
    renameLayer(d, 0, '  Фон  ');
    expect(d.layers[0].name).toBe('Фон');
  });

  it('cuts a name longer than MAX_LAYER_NAME instead of refusing it', () => {
    const d = doc();
    renameLayer(d, 0, 'Слой с именем');
    expect(d.layers[0].name).toBe('Слой с имене');
  });

  it('drops the field for an empty name — the row falls back to its position', () => {
    const d = doc();
    renameLayer(d, 0, 'Фон');
    renameLayer(d, 0, '   ');
    expect('name' in d.layers[0]).toBe(false);
  });

  it('keeps the document valid', () => {
    const d = doc();
    renameLayer(d, 0, 'Фон');
    expect(validateDocument(d).ok).toBe(true);
  });

  it('refuses an index outside the layer stack', () => {
    expect(() => renameLayer(doc(), 5, 'Фон')).toThrow(RangeError);
  });
});


describe('pasteNeedsConfirm', () => {
  /** Two layers × three frames; only layer 0 / frame 0 holds a stroke. */
  function sparse() {
    const doc = createDocument();
    addLayer(doc, 1);
    addFrame(doc, 0);
    addFrame(doc, 1);
    addStroke(doc, 0, 0, { points: [0, 0], width: 8, color: '#112233' });
    return doc;
  }

  it('reports an empty target as nothing to ask about', () => {
    expect(pasteNeedsConfirm(sparse(), { frames: [1, 2], layers: [0, 1] })).toEqual({
      nonEmpty: false,
      frames: 2,
      layers: 2,
    });
  });

  it('reports a target holding a stroke anywhere as non-empty', () => {
    expect(pasteNeedsConfirm(sparse(), { frames: [0, 1], layers: [0] })).toEqual({
      nonEmpty: true,
      frames: 2,
      layers: 1,
    });
  });

  it('counts a single cell as one frame and one layer — the second dialog is skipped', () => {
    expect(pasteNeedsConfirm(sparse(), { frames: [0], layers: [0] })).toEqual({
      nonEmpty: true,
      frames: 1,
      layers: 1,
    });
  });
});

describe('isEmptyDocument', () => {
  it('a fresh sheet is empty', () => {
    expect(isEmptyDocument(createDocument())).toBe(true);
  });

  it('one stroke anywhere is enough to make it worth keeping', () => {
    const doc = createDocument();
    addFrame(doc, 0);
    addLayer(doc, 1);
    const tool = internTool(doc, { kind: 'pencil', dialect: 'toonio', width: 8, color: '#000000' });
    doc.layers[1].frames[1].strokes.push({ points: [0, 0, 8, 8], tool_id: tool });
    expect(isEmptyDocument(doc)).toBe(false);
  });

  it('empty cells on many frames and layers are still empty', () => {
    const doc = createDocument();
    addFrame(doc, 0);
    addLayer(doc, 1);
    expect(isEmptyDocument(doc)).toBe(true);
  });
});
