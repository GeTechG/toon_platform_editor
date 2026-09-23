/**
 * Decoder for Tonio's binary `.toon` (toon.js `Toon.Degenerate`): a flat
 * Int16 stream whose meaning is positional, with legacy shapes for versions
 * 1–4. Pure — no DOM, no editor state — so it is testable and reusable.
 *
 * Untrusted input: every length comes out of the file, so the cursor checks
 * the buffer before each read and an error is a value, never a throw and
 * never a half-parsed document.
 */

import {
  FIXED_POINT_SCALE,
  MAX_FRAMES,
  MAX_LAYERS,
  MAX_TOTAL_POINTS,
  MAX_LAYER_NAME,
  SCHEMA_VERSION,
  STROKE_COORD_MAX,
  STROKE_COORD_MIN,
} from './constants';
import { SQUARE_STAMP } from './types';
import type { Layer, ToolDescriptor, ToonDocument } from './types';
import { laySmoothPoints } from '../render/smoothing';
import { validateDocument } from './validate';
import { t } from '../i18n';

/** The reference canvas is fixed; the file carries no size of its own. */
export const TOONIO_CANVAS_WIDTH = 1280;
export const TOONIO_CANVAS_HEIGHT = 720;

/** Reference signature word that marks a versioned file (toon.js: `Write(999)`). */
const SIGNATURE = 999;
const MAX_VERSION = 5;

/** Defaults of the legacy `.json` save, which stored neither (toon.js:1240-1283). */
const LEGACY_JSON_FPS = 13;
const LEGACY_JSON_WIDTH = 5;

/** tools.js tool types. */
const ERASER = 0;
const PENCIL = 1;
const FEATHER = 2;
const MEGAERASER = 3;
const PIXEL = 4;

export type ToonImportResult =
  /** `original` is the title the reference stored in the file (v3+); '' when it carries none. */
  | { ok: true; doc: ToonDocument; original: string }
  | { ok: false; error: string };

class Truncated extends Error {}
/** A refusal worded for the person holding the file. */
class Refusal extends Error {}

/** Cursor over the Int16 stream that refuses to read past the end. */
class Reader {
  #at = 0;

  constructor(private readonly words: Int16Array) {}

  next(): number {
    if (this.#at >= this.words.length) {
      throw new Truncated(t('file.truncated'));
    }
    return this.words[this.#at++];
  }

  peek(): number | undefined {
    return this.#at < this.words.length ? this.words[this.#at] : undefined;
  }

  get exhausted(): boolean {
    return this.#at === this.words.length;
  }

  /** A count read from the file: the reference stores it as int16 and wraps past 32767. */
  count(): number {
    const raw = this.next();
    return raw < 0 ? 65536 + raw : raw;
  }

  /** Length-prefixed char array (layer name, original title). */
  string(): string {
    const length = this.count();
    let text = '';
    for (let i = 0; i < length; i++) {
      text += String.fromCharCode(this.next());
    }
    return text;
  }
}

export function decodeToon(buffer: ArrayBuffer): ToonImportResult {
  if (buffer.byteLength < 2 || buffer.byteLength % 2 !== 0) {
    return { ok: false, error: t('file.empty') };
  }
  try {
    const { doc, original } = read(new Reader(new Int16Array(buffer)));
    return checked(doc, original);
  } catch (error) {
    if (error instanceof Truncated) {
      return { ok: false, error: t('file.truncated_long') };
    }
    if (error instanceof Refusal) {
      return { ok: false, error: error.message };
    }
    console.warn('toon decode failed:', error);
    return { ok: false, error: t('file.truncated_long') };
  }
}

function read(reader: Reader): { doc: ToonDocument; original: string } {
  const layerCount = reader.next();
  const frameCount = reader.next();
  const frameRate = reader.next();
  let version = 1;
  if (reader.peek() === SIGNATURE) {
    reader.next();
    version = reader.next();
  }
  if (version < 1 || version > MAX_VERSION) {
    throw new Refusal(t('file.version_unsupported', { version }));
  }
  if (layerCount < 1 || layerCount > MAX_LAYERS || frameCount < 1) {
    throw new Refusal(t('file.bad_header'));
  }
  // The limits are known before a single frame is read. A clone frame is one
  // word in the file and a whole copy in memory: a small crafted file would
  // otherwise build millions of points before `checked` got to say no.
  if (frameCount > MAX_FRAMES) {
    throw new Refusal(t('file.over_limits'));
  }
  let points = 0;
  const tally = (strokes: readonly { points: readonly number[] }[]) => {
    for (const stroke of strokes) {
      points += stroke.points.length / 2;
    }
    if (points > MAX_TOTAL_POINTS) {
      throw new Refusal(t('file.over_limits'));
    }
  };
  const original = version >= 3 ? reader.string() : '';

  const tools: ToolDescriptor[] = [];
  if (version >= 5) {
    const count = reader.count();
    for (let i = 0; i < count; i++) {
      tools.push(readTool(reader));
    }
  }

  const layers: Layer[] = [];
  for (let l = 0; l < layerCount; l++) {
    const hidden = reader.next() === 0;
    // An unnamed layer is named by its position, so the field stays absent.
    const name = version >= 2 ? reader.string().slice(0, MAX_LAYER_NAME) : '';
    const frames: Layer['frames'] = [];
    for (let f = 0; f < frameCount; f++) {
      if (version >= 4 && reader.next() === 1) {
        // A clone frame shares its predecessor's object in the reference; our
        // frames are independent, so it becomes a copy.
        const previous = frames[f - 1];
        tally(previous?.strokes ?? []);
        frames.push({
          strokes: (previous?.strokes ?? []).map((stroke) => ({
            points: stroke.points.slice(),
            tool_id: stroke.tool_id,
          })),
        });
        continue;
      }
      const strokes = readStrokes(reader, version, tools);
      tally(strokes);
      frames.push({ strokes });
    }
    layers.push(name ? { hidden, name, frames } : { hidden, frames });
  }

  if (!reader.exhausted) {
    // The writer emits exactly as many words as the drawing needs, so a tail
    // means this is not a `.toon` — version 1 files carry no signature to
    // check instead.
    throw new Refusal(t('file.trailing_data'));
  }
  return {
    original,
    doc: {
      schema_version: SCHEMA_VERSION,
      width: TOONIO_CANVAS_WIDTH * FIXED_POINT_SCALE,
      height: TOONIO_CANVAS_HEIGHT * FIXED_POINT_SCALE,
      frame_rate: Math.min(60, Math.max(1, frameRate)),
      tools,
      // The reference draws layer 0 last, so its first layer is the topmost one;
      // ours renders bottom-up.
      layers: layers.reverse(),
    },
  };
}

function readStrokes(
  reader: Reader,
  version: number,
  tools: ToolDescriptor[],
): { points: number[]; tool_id: number }[] {
  const strokes: { points: number[]; tool_id: number }[] = [];
  const lineCount = reader.count();
  for (let i = 0; i < lineCount; i++) {
    let toolId: number;
    if (version >= 5) {
      toolId = reader.next();
      if (!tools[toolId]) {
        throw new Refusal(t('file.unknown_tool_ref', { tool: toolId }));
      }
    } else {
      toolId = internLegacyTool(readLegacyTool(reader), tools);
    }
    const pointCount = reader.count();
    const points: number[] = [];
    for (let p = 0; p < pointCount; p++) {
      if (version >= 5) {
        points.push(scale(reader.next()), scale(reader.next()));
      } else {
        // Pre-v5 points are sign/magnitude pairs: a flag word, then the value.
        const signX = reader.next();
        const x = reader.next();
        const signY = reader.next();
        const y = reader.next();
        points.push(scale((signX === 1 ? 1 : -1) * x), scale((signY === 1 ? 1 : -1) * y));
      }
    }
    if (points.length >= 2) {
      // An imported line is the reference's own, so it is laid down by the
      // rule of the brush that drew it — the geometry is not recomputed, only
      // written the way the shared reader reads it.
      strokes.push({ points: laySmoothPoints(points), tool_id: toolId });
    }
  }
  return strokes;
}

/** v5 tool table entry. */
function readTool(reader: Reader): ToolDescriptor {
  const type = reader.next();
  const width = scale(reader.next());
  const color = type === ERASER || type === MEGAERASER ? '#000000' : readColor(reader);
  const fill = type === FEATHER ? readColor(reader) : '#000000';
  return toolDescriptor(type, width, color, fill);
}

/** Pre-v5 files store the tool inline on every line, always with both colors. */
function readLegacyTool(reader: Reader): ToolDescriptor {
  const type = reader.next();
  const width = scale(reader.next());
  const color = readColor(reader);
  const fill = readColor(reader);
  return toolDescriptor(type, width, type === ERASER || type === MEGAERASER ? '#000000' : color, fill);
}

function toolDescriptor(type: number, width: number, color: string, fill: string): ToolDescriptor {
  const clamped = Math.min(4800, Math.max(1, width));
  switch (type) {
    case PENCIL:
      return { kind: 'pencil', geometry: 'smooth', width: clamped, color };
    case ERASER:
      return { kind: 'eraser', geometry: 'smooth', width: clamped };
    case FEATHER:
      return { kind: 'feather', geometry: 'smooth', width: clamped, color, fill };
    case PIXEL:
      return { kind: 'stamp', geometry: 'line', width: clamped, color, shape: [...SQUARE_STAMP] };
    case MEGAERASER:
      throw new Refusal(t('file.mega_eraser'));
    default:
      throw new Refusal(t('file.unknown_tool', { type }));
  }
}

/** Structurally interns a legacy inline tool, mirroring the reference's GetToolS. */
function internLegacyTool(tool: ToolDescriptor, tools: ToolDescriptor[]): number {
  const key = JSON.stringify(tool);
  const existing = tools.findIndex((candidate) => JSON.stringify(candidate) === key);
  if (existing !== -1) {
    return existing;
  }
  tools.push(tool);
  return tools.length - 1;
}

function readColor(reader: Reader): string {
  const channel = (): string => {
    const value = reader.next();
    return Math.min(255, Math.max(0, value)).toString(16).padStart(2, '0');
  };
  return `#${channel()}${channel()}${channel()}`;
}

/**
 * Reference units are logical pixels; ours are eighths of one. A point that
 * flew past the representable range is pinned to the edge rather than losing
 * the whole file: it is far off-canvas either way.
 */
function scale(value: number): number {
  return Math.min(STROKE_COORD_MAX, Math.max(STROKE_COORD_MIN, value * FIXED_POINT_SCALE));
}

/**
 * Tonio's pre-binary `.json` save (toon.js:1240-1283): either the full
 * `{Data: {FPS}, Frames}` object or a bare array of frames. One visible
 * layer of pencil lines — the format knew nothing else.
 */
export function decodeLegacyJson(text: string): ToonImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    // The parser's words are English and about characters; they stay in the console.
    console.warn('legacy json parse failed:', error);
    return { ok: false, error: t('file.not_json') };
  }
  const source = Array.isArray(data) ? data : (data as { Frames?: unknown } | null)?.Frames;
  // A frame is a list of lines: `[1,2,3]` is some other JSON, not three empty frames.
  if (!Array.isArray(source) || source.length === 0 || !source.every(Array.isArray)) {
    return { ok: false, error: t('file.no_frames') };
  }
  const fps = Math.round(Number((data as { Data?: { FPS?: unknown } }).Data?.FPS) || LEGACY_JSON_FPS);

  const tools: ToolDescriptor[] = [];
  const frames = source.map((frame) => ({
    strokes: (Array.isArray(frame) ? frame : []).flatMap((line) => {
      // A line is either `{Width, Color, Cs}` or, in the bare form, its points.
      const raw = Array.isArray(line) ? { Cs: line } : (line as { Width?: number; Color?: string; Cs?: unknown });
      const points = (Array.isArray(raw?.Cs) ? raw.Cs : []).flatMap((point: { x?: number; y?: number }) => [
        scale(Number(point?.x) || 0),
        scale(Number(point?.y) || 0),
      ]);
      if (points.length < 2) {
        return [];
      }
      const tool = toolDescriptor(
        PENCIL,
        scale(Number(raw?.Width) || LEGACY_JSON_WIDTH),
        hexColor(raw?.Color),
        '#000000',
      );
      return [{ points: laySmoothPoints(points), tool_id: internLegacyTool(tool, tools) }];
    }),
  }));

  return checked(
    {
      schema_version: SCHEMA_VERSION,
      width: TOONIO_CANVAS_WIDTH * FIXED_POINT_SCALE,
      height: TOONIO_CANVAS_HEIGHT * FIXED_POINT_SCALE,
      frame_rate: Math.min(60, Math.max(1, fps)),
      tools,
      layers: [{ hidden: false, frames }],
    },
    '',
  );
}

/** `#abc`, `#ABCDEF` → `#aabbcc`, `#abcdef`; anything else is drawn in black. */
function hexColor(value: unknown): string {
  const hex = typeof value === 'string' ? /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1] : undefined;
  if (!hex) {
    return '#000000';
  }
  return `#${(hex.length === 3 ? hex.replace(/./g, '$&$&') : hex).toLowerCase()}`;
}

/**
 * What a decoder builds becomes the draft: a document the validator refuses
 * is a draft that never opens again and a work the API will not take. Colours
 * and rates are mended on the way in, so what is left is a file past the
 * limits — too many frames, lines or points.
 */
function checked(doc: ToonDocument, original: string): ToonImportResult {
  const result = validateDocument(doc);
  if (!result.ok) {
    console.warn('imported document does not validate:', result.issues);
    return { ok: false, error: t('file.over_limits') };
  }
  return { ok: true, doc, original };
}
