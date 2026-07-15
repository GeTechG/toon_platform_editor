import { describe, expect, it } from 'bun:test';
import { validateDocument } from '../format/validate';
import { addFrame, addStroke, createDocument, removeFrame, setFrameRate } from './operations';

describe('createDocument', () => {
  it('creates a valid document with the research defaults', () => {
    const doc = createDocument();
    expect(doc.schema_version).toBe(1);
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

describe('addStroke', () => {
  it('appends strokes to the end of the frame', () => {
    const doc = createDocument();
    addStroke(doc, 0, { points: [0, 0, 10, 10], width: 32, color: '#000000' });
    addStroke(doc, 0, { points: [20, 20], width: 16, color: '#ff0000' });
    expect(doc.frames[0].strokes.map((s) => s.color)).toEqual(['#000000', '#ff0000']);
  });

  it('rejects unquantized (fractional) coordinates', () => {
    const doc = createDocument();
    expect(() => addStroke(doc, 0, { points: [0.5, 1], width: 8, color: '#000000' })).toThrow(
      RangeError,
    );
  });

  it('rejects odd coordinate counts, out-of-canvas points and bad attributes', () => {
    const doc = createDocument();
    expect(() => addStroke(doc, 0, { points: [1, 2, 3], width: 8, color: '#000000' })).toThrow();
    expect(() => addStroke(doc, 0, { points: [4801, 0], width: 8, color: '#000000' })).toThrow();
    expect(() => addStroke(doc, 0, { points: [1, 2], width: 0, color: '#000000' })).toThrow();
    expect(() => addStroke(doc, 0, { points: [1, 2], width: 8, color: '#FF0000' })).toThrow();
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
    expect(() => createDocument({ width: 65536 })).toThrow(RangeError);
    expect(() => createDocument({ height: 65536 })).toThrow(RangeError);
    expect(validateDocument(createDocument({ width: 65535, height: 65535 })).ok).toBe(true);
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
    for (let i = 0; i < 16384; i++) {
      doc.frames[0].strokes.push({ points: [1, 2], width: 8, color: '#000000' });
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
