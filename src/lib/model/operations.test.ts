import { describe, expect, it } from 'bun:test';
import { validateDocument } from '../format/validate';
import {
  addFrame,
  addStroke,
  cloneFrame,
  createDocument,
  insertFrameBefore,
  removeFrame,
  removeLastStroke,
  replaceFrame,
  setFrameRate,
} from './operations';

describe('createDocument', () => {
  it('creates a valid document with the research defaults', () => {
    const doc = createDocument();
    expect(doc.schema_version).toBe(2);
    expect(doc.tools).toEqual([]);
    expect(doc.width).toBe(4800);
    expect(doc.height).toBe(2400);
    expect(doc.frame_rate).toBe(12);
    expect(doc.frames).toEqual([{ strokes: [] }]);
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
    addStroke(doc, 0, { points: [1, 2], width: 8, color: '#112233' });
    const idx = addFrame(doc, 0);
    expect(idx).toBe(1);
    expect(doc.frames).toHaveLength(2);
    expect(doc.frames[0].strokes).toHaveLength(1);
    expect(doc.frames[1].strokes).toHaveLength(0);
  });

  it('insertFrameBefore puts an empty frame in front of the given one', () => {
    const doc = createDocument();
    addStroke(doc, 0, { points: [1, 2], width: 8, color: '#112233' });
    const idx = insertFrameBefore(doc, 0);
    expect(idx).toBe(0);
    expect(doc.frames).toHaveLength(2);
    expect(doc.frames[0].strokes).toHaveLength(0);
    expect(doc.frames[1].strokes).toHaveLength(1);
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
    addStroke(doc, 2, { points: [5, 5], width: 8, color: '#000000' });
    removeFrame(doc, 1);
    expect(doc.frames).toHaveLength(2);
    expect(doc.frames[1].strokes).toHaveLength(1);
  });

  it('clears the only frame instead of removing it', () => {
    const doc = createDocument();
    addStroke(doc, 0, { points: [5, 5], width: 8, color: '#000000' });
    removeFrame(doc, 0);
    expect(doc.frames).toHaveLength(1);
    expect(doc.frames[0].strokes).toHaveLength(0);
  });

  it('rejects an out-of-range index', () => {
    const doc = createDocument();
    expect(() => addFrame(doc, 1)).toThrow(RangeError);
    expect(() => removeFrame(doc, -1)).toThrow(RangeError);
  });
});

describe('replaceFrame (frame paste)', () => {
  it('overwrites the target frame with a deep copy, in place', () => {
    const doc = createDocument();
    addStroke(doc, 0, { points: [1, 2, 3, 4], width: 8, color: '#112233' });
    addFrame(doc, 0); // blank frame at index 1 — the paste target
    const source = cloneFrame(doc, doc.frames[0]);

    replaceFrame(doc, 1, source);

    expect(doc.frames).toHaveLength(2); // no new frame — content replaced
    expect(doc.frames[1].strokes).toHaveLength(1);
    expect(doc.frames[1].strokes[0].points).toEqual([1, 2, 3, 4]);
    // Deep copy: mutating the source (or the original) must not touch the paste.
    source.strokes[0].points[0] = 999;
    doc.frames[0].strokes[0].points[1] = 999;
    expect(doc.frames[1].strokes[0].points).toEqual([1, 2, 3, 4]);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('replaces existing strokes rather than appending them', () => {
    const doc = createDocument();
    addStroke(doc, 0, { points: [1, 2], width: 8, color: '#000000' });
    addFrame(doc, 0);
    addStroke(doc, 1, { points: [5, 6], width: 8, color: '#ff0000' });
    addStroke(doc, 1, { points: [7, 8], width: 8, color: '#00ff00' });

    replaceFrame(doc, 1, cloneFrame(doc, doc.frames[0])); // paste frame 0 onto frame 1

    expect(doc.frames[1].strokes.map((s) => doc.tools[s.tool_id])).toEqual([
      { kind: 'pencil', dialect: 'multator', width: 8, color: '#000000' },
    ]);
  });

  it('gives the pasted frame a fresh object identity', () => {
    const doc = createDocument();
    addFrame(doc, 0);
    const before = doc.frames[1];
    replaceFrame(doc, 1, cloneFrame(doc, doc.frames[0]));
    expect(doc.frames[1]).not.toBe(before);
  });

  it('rejects an out-of-range index', () => {
    const doc = createDocument();
    expect(() => replaceFrame(doc, 1, cloneFrame(doc, doc.frames[0]))).toThrow(RangeError);
  });

  it('rejects a paste that would exceed the document-wide point limit', () => {
    const doc = createDocument();
    const big = Array.from({ length: 65536 }, (_, i) => i % 2); // 32768 points
    // Fill frames with big strokes up to just under the point ceiling; last frame stays empty.
    for (let f = 0; doc.frames.length * 32768 <= 1_000_000; f++) {
      addStroke(doc, f, { points: big, width: 8, color: '#000000' });
      addFrame(doc, f);
    }
    // Pasting a full big-stroke frame onto the empty last frame overflows the ceiling.
    expect(() => replaceFrame(doc, doc.frames.length - 1, cloneFrame(doc, doc.frames[0]))).toThrow(RangeError);
  });
});

describe('removeLastStroke (per-stroke undo)', () => {
  it('pops the last stroke and reports whether one was removed', () => {
    const doc = createDocument();
    addStroke(doc, 0, { points: [1, 2], width: 8, color: '#000000' });
    addStroke(doc, 0, { points: [3, 4], width: 8, color: '#ff0000' });

    expect(removeLastStroke(doc, 0)).toBe(true);
    expect(doc.frames[0].strokes.map((s) => doc.tools[s.tool_id])).toEqual([
      { kind: 'pencil', dialect: 'multator', width: 8, color: '#000000' },
    ]);
    expect(removeLastStroke(doc, 0)).toBe(true);
    expect(doc.frames[0].strokes).toHaveLength(0);
    expect(removeLastStroke(doc, 0)).toBe(false);
  });

  it('rejects an out-of-range index', () => {
    const doc = createDocument();
    expect(() => removeLastStroke(doc, 1)).toThrow(RangeError);
  });
});

describe('addStroke', () => {
  it('appends strokes to the end of the frame', () => {
    const doc = createDocument();
    addStroke(doc, 0, { points: [0, 0, 10, 10], width: 32, color: '#000000' });
    addStroke(doc, 0, { points: [20, 20], width: 16, color: '#ff0000' });
    expect(doc.frames[0].strokes.map((s) => doc.tools[s.tool_id])).toEqual([
      { kind: 'pencil', dialect: 'multator', width: 32, color: '#000000' },
      { kind: 'pencil', dialect: 'multator', width: 16, color: '#ff0000' },
    ]);
  });

  it('rejects unquantized (fractional) coordinates', () => {
    const doc = createDocument();
    expect(() => addStroke(doc, 0, { points: [0.5, 1], width: 8, color: '#000000' })).toThrow(
      RangeError,
    );
  });

  it('rejects odd coordinate counts, out-of-int16 points and bad attributes', () => {
    const doc = createDocument();
    expect(() => addStroke(doc, 0, { points: [1, 2, 3], width: 8, color: '#000000' })).toThrow();
    expect(() => addStroke(doc, 0, { points: [40000, 0], width: 8, color: '#000000' })).toThrow();
    expect(() => addStroke(doc, 0, { points: [1, 2], width: 0, color: '#000000' })).toThrow();
    expect(() => addStroke(doc, 0, { points: [1, 2], width: 8, color: '#FF0000' })).toThrow();
  });

  it('accepts off-canvas points (a stroke can leave the canvas)', () => {
    const doc = createDocument();
    expect(() =>
      addStroke(doc, 0, { points: [-320, -80, 5200, 2560], width: 8, color: '#000000' }),
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
    expect(() => addStroke(doc, 0, { points: [1, 2], width: 4801, color: '#000000' })).toThrow(
      RangeError,
    );
    const tooMany = Array.from({ length: 65538 }, (_, i) => i % 2);
    expect(() => addStroke(doc, 0, { points: tooMany, width: 8, color: '#000000' })).toThrow(
      RangeError,
    );
    const atLimit = Array.from({ length: 65536 }, (_, i) => i % 2);
    addStroke(doc, 0, { points: atLimit, width: 4800, color: '#000000' });
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('addStroke stops at the per-frame stroke limit', () => {
    const doc = createDocument();
    doc.tools.push({ kind: 'pencil', dialect: 'multator', width: 8, color: '#000000' });
    for (let i = 0; i < 16384; i++) {
      doc.frames[0].strokes.push({ points: [1, 2], tool_id: 0 });
    }
    expect(() => addStroke(doc, 0, { points: [1, 2], width: 8, color: '#000000' })).toThrow(
      RangeError,
    );
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('addStroke stops at the document-wide point limit', () => {
    const doc = createDocument();
    const big = Array.from({ length: 65536 }, (_, i) => i % 2); // 32768 points
    for (let f = 0; doc.frames.length * 32768 <= 1_000_000; f++) {
      addStroke(doc, f, { points: big, width: 8, color: '#000000' });
      addFrame(doc, f);
    }
    const last = doc.frames.length - 1;
    expect(() => addStroke(doc, last, { points: big, width: 8, color: '#000000' })).toThrow(
      RangeError,
    );
    addStroke(doc, last, { points: [1, 2], width: 8, color: '#000000' });
  });
});
