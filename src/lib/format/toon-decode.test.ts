import { describe, expect, it } from 'bun:test';
import { TOONIO_CANVAS_HEIGHT, TOONIO_CANVAS_WIDTH, decodeToon } from './toon-decode';
import { validateDocument } from './validate';

/** Builds a `.toon` body the way the reference writer does (Int16 words). */
function encode(words: number[]): ArrayBuffer {
  return Int16Array.from(words).buffer;
}

const header = (layers: number, frames: number, fps = 12, version = 5) =>
  [layers, frames, fps, 999, version, 0]; // …, magic, version, empty original name

/** One pencil tool: type 1, width 5, rgb 0,0,0. */
const PENCIL = [1, 5, 0, 0, 0];

function ok(result: ReturnType<typeof decodeToon>) {
  if (!result.ok) throw new Error(`expected a decoded document, got: ${result.error}`);
  return result.doc;
}

describe('decodeToon: version 5', () => {
  it('reads the header, the tool table and one line', () => {
    const doc = ok(decodeToon(encode([
      ...header(1, 1),
      1, ...PENCIL,
      1, 0, // layer visible, empty name
      0, 1, // not a clone, one line
      0, 2, 10, 20, 30, 40, // tool 0, two points
    ])));
    expect(doc.width).toBe(TOONIO_CANVAS_WIDTH * 8);
    expect(doc.height).toBe(TOONIO_CANVAS_HEIGHT * 8);
    expect(doc.frame_rate).toBe(12);
    expect(doc.tools).toEqual([{ kind: 'pencil', dialect: 'toonio', width: 40, color: '#000000' }]);
    expect(doc.layers[0].frames[0].strokes).toEqual([{ points: [80, 160, 240, 320], tool_id: 0 }]);
  });

  it('keeps the hidden flag of a layer', () => {
    const doc = ok(decodeToon(encode([
      ...header(1, 1), 1, ...PENCIL,
      0, 0, // hidden
      0, 0, // no clone, no lines
    ])));
    expect(doc.layers[0].hidden).toBe(true);
  });

  it('unrolls a clone frame into an independent copy', () => {
    const doc = ok(decodeToon(encode([
      ...header(1, 2), 1, ...PENCIL,
      1, 0,
      0, 1, 0, 1, 10, 10, // frame 0: one line, one point
      1, // frame 1: clone of frame 0
    ])));
    const [first, second] = doc.layers[0].frames;
    expect(second.strokes).toEqual(first.strokes);
    expect(second.strokes[0]).not.toBe(first.strokes[0]);
    second.strokes.push({ points: [0, 0], tool_id: 0 });
    expect(first.strokes).toHaveLength(1);
  });

  it('puts the reference top layer last — its layer 0 draws on top, ours draws first', () => {
    const doc = ok(decodeToon(encode([
      ...header(2, 1), 1, ...PENCIL,
      1, 0, 0, 1, 0, 1, 10, 10, // reference layer 0 (topmost): one line
      1, 0, 0, 0, // reference layer 1 (below): empty
    ])));
    expect(doc.layers).toHaveLength(2);
    expect(doc.layers[0].frames[0].strokes).toHaveLength(0);
    expect(doc.layers[1].frames[0].strokes).toHaveLength(1);
  });

  it('maps the feather and pixel tools, and refuses the mega eraser', () => {
    const doc = ok(decodeToon(encode([
      ...header(1, 1),
      2, 2, 5, 0, 0, 0, 255, 0, 0, 4, 8, 0, 38, 255,
      1, 0, 0, 0,
    ])));
    expect(doc.tools).toEqual([
      { kind: 'feather', dialect: 'toonio', width: 40, color: '#000000', fill: '#ff0000' },
      { kind: 'pixel', dialect: 'toonio', width: 64, color: '#0026ff' },
    ]);

    const rejected = decodeToon(encode([...header(1, 1), 1, 3, 5, 1, 0, 0, 0]));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error).toContain('мега-ластик');
  });
});

describe('decodeToon: the result is a document the editor accepts', () => {
  it('passes the real validator', () => {
    const doc = ok(decodeToon(encode([
      ...header(2, 2), 2, ...PENCIL, 0, 5,
      1, 0, 0, 1, 0, 2, 10, 20, 30, 40, 0, 1, 1, 2, 0, 0, 8, 8,
      0, 0, 0, 0, 0, 0,
    ])));
    expect(validateDocument(doc)).toEqual({ ok: true, issues: [] });
  });
});

describe('decodeToon: rejections', () => {
  it('refuses a blob that is not a drawing at all', () => {
    // Version 1 files carry no signature, so the guards are a plausible
    // header and a stream that ends exactly where the drawing does.
    expect(decodeToon(encode([0, 0, 0, 7, 7, 7])).ok).toBe(false);
    expect(decodeToon(encode([1, 1, 12, 1, 0, 42, 42, 42])).ok).toBe(false);
  });

  it('refuses a file cut short', () => {
    const result = decodeToon(encode([...header(1, 1), 1, ...PENCIL, 1, 0, 0, 1, 0, 8, 1, 1]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('обрыв');
  });

  it('refuses coordinates the editor cannot represent', () => {
    const result = decodeToon(encode([
      ...header(1, 1), 1, ...PENCIL,
      1, 0, 0, 1, 0, 1, 30000, 0,
    ]));
    expect(result.ok).toBe(false);
  });

  it('refuses an empty buffer', () => {
    expect(decodeToon(new ArrayBuffer(0)).ok).toBe(false);
  });
});

describe('decodeToon: legacy versions', () => {
  it('reads a version 1 file: no signature, inline tools, sign-magnitude points', () => {
    const doc = ok(decodeToon(encode([
      1, 1, 12, // header without the 999 signature
      1, // layer visible
      1, // one line
      1, 5, 0, 0, 0, 255, 0, 0, // inline tool: pencil, width 5, color, fill
      2, // two points
      1, 10, 0, 20, // +10, -20
      1, 30, 1, 40,
    ])));
    expect(doc.tools).toEqual([{ kind: 'pencil', dialect: 'toonio', width: 40, color: '#000000' }]);
    expect(doc.layers[0].frames[0].strokes[0].points).toEqual([80, -160, 240, 320]);
  });
});
