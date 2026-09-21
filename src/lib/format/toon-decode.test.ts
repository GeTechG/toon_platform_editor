import { SQUARE_STAMP } from './types';
import { describe, expect, it } from 'bun:test';
import { STROKE_COORD_MAX, STROKE_COORD_MIN } from './constants';
import { TOONIO_CANVAS_HEIGHT, TOONIO_CANVAS_WIDTH, decodeLegacyJson, decodeToon } from './toon-decode';
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
    expect(doc.tools).toEqual([{ kind: 'pencil', geometry: 'smooth', width: 40, color: '#000000' }]);
    // Laid down for the shared reader the way the Tonio brush lays a line:
    // its first point repeated, so the curve starts where the reference's did.
    expect(doc.layers[0].frames[0].strokes)
      .toEqual([{ points: [80, 160, 80, 160, 240, 320], tool_id: 0 }]);
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
      { kind: 'feather', geometry: 'smooth', width: 40, color: '#000000', fill: '#ff0000' },
      { kind: 'stamp', geometry: 'line', width: 64, color: '#0026ff', shape: SQUARE_STAMP },
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

  it('refuses an empty buffer', () => {
    expect(decodeToon(new ArrayBuffer(0)).ok).toBe(false);
  });
});

/** Length-prefixed char array, the way the reference writes a string. */
const str = (text: string) => [text.length, ...[...text].map((c) => c.charCodeAt(0))];

describe('decodeToon: names', () => {
  it('keeps the layer names and the title of the original', () => {
    const result = decodeToon(encode([
      2, 1, 12, 999, 5, ...str('Мой мульт'),
      1, ...PENCIL,
      1, ...str('Герой'),
      0, 0,
      1, ...str('Фон'),
      0, 0,
    ]));
    if (!result.ok) throw new Error(result.error);
    expect(result.original).toBe('Мой мульт');
    // The reference's layer 0 is the topmost one; ours renders bottom-up.
    expect(result.doc.layers.map((layer) => layer.name)).toEqual(['Фон', 'Герой']);
    expect(validateDocument(result.doc).ok).toBe(true);
  });

  it('leaves an unnamed layer without a name and an untitled file without a title', () => {
    const result = decodeToon(encode([
      1, 1, 12, 999, 5, 0,
      1, ...PENCIL,
      1, 0,
      0, 0,
    ]));
    if (!result.ok) throw new Error(result.error);
    expect(result.original).toBe('');
    expect(result.doc.layers[0].name).toBeUndefined();
  });
});

describe('decodeToon: a point that flew off the canvas', () => {
  it('clamps it to the document range instead of rejecting the file', () => {
    // One stroke leaves the representable range; the rest of the drawing
    // must still open — the reference never loses a file over one point.
    const doc = ok(decodeToon(encode([
      ...header(1, 1), 1, ...PENCIL,
      1, 0, 0, 2,
      0, 2, 30000, 10, -30000, 20,
      0, 2, 1, 2, 3, 4,
    ])));
    const [flown, intact] = doc.layers[0].frames[0].strokes;
    expect(flown.points).toEqual([STROKE_COORD_MAX, 80, STROKE_COORD_MAX, 80, STROKE_COORD_MIN, 160]);
    expect(intact.points).toEqual([8, 16, 8, 16, 24, 32]);
    expect(validateDocument(doc).ok).toBe(true);
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
    expect(doc.tools).toEqual([{ kind: 'pencil', geometry: 'smooth', width: 40, color: '#000000' }]);
    expect(doc.layers[0].frames[0].strokes[0].points).toEqual([80, -160, 80, -160, 240, 320]);
  });
});

describe('decodeLegacyJson', () => {
  it('reads the full form: Data.FPS, per-line width and color', () => {
    const doc = ok(decodeLegacyJson(JSON.stringify({
      Data: { FPS: 10 },
      Frames: [
        [{ Width: 3, Color: '#ff0000', Cs: [{ x: 10, y: 20 }, { x: 30, y: 40 }] }],
        [{ Width: 8, Color: '#00ff00', Cs: [{ x: 1, y: 2 }] }],
      ],
    })));
    expect(doc.frame_rate).toBe(10);
    expect(doc.width).toBe(TOONIO_CANVAS_WIDTH * 8);
    expect(doc.height).toBe(TOONIO_CANVAS_HEIGHT * 8);
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0].hidden).toBe(false);
    expect(doc.tools).toEqual([
      { kind: 'pencil', geometry: 'smooth', width: 24, color: '#ff0000' },
      { kind: 'pencil', geometry: 'smooth', width: 64, color: '#00ff00' },
    ]);
    // Laid down for the shared reader the way the Tonio brush lays a line:
    // its first point repeated, so the curve starts where the reference's did.
    expect(doc.layers[0].frames[0].strokes)
      .toEqual([{ points: [80, 160, 80, 160, 240, 320], tool_id: 0 }]);
    expect(doc.layers[0].frames[1].strokes).toEqual([{ points: [8, 16, 8, 16], tool_id: 1 }]);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('reads the bare array form as a black pencil of width 5 at 13 fps', () => {
    const doc = ok(decodeLegacyJson(JSON.stringify([[[{ x: 1, y: 2 }, { x: 3, y: 4 }]]])));
    expect(doc.frame_rate).toBe(13);
    expect(doc.tools).toEqual([{ kind: 'pencil', geometry: 'smooth', width: 40, color: '#000000' }]);
    expect(doc.layers[0].frames[0].strokes).toEqual([{ points: [8, 16, 8, 16, 24, 32], tool_id: 0 }]);
  });

  it('clamps a point that flew off the canvas', () => {
    const doc = ok(decodeLegacyJson(JSON.stringify([[[{ x: 30000, y: 0 }]]])));
    expect(doc.layers[0].frames[0].strokes[0].points).toEqual([STROKE_COORD_MAX, 0, STROKE_COORD_MAX, 0]);
  });

  it('refuses text that is not JSON', () => {
    const result = decodeLegacyJson('{not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeString();
  });

  it('refuses JSON that carries no frames', () => {
    expect(decodeLegacyJson('{"Data":{"FPS":10}}').ok).toBe(false);
    expect(decodeLegacyJson('[]').ok).toBe(false);
  });
});
