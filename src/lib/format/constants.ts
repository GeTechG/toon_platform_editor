/**
 * Format constants and editor defaults.
 *
 */

/** Version the editor writes; older ones are migrated on load. */
export const SCHEMA_VERSION = 7;
/** Highest schema version the loader accepts. */
export const MAX_SUPPORTED_SCHEMA_VERSION = SCHEMA_VERSION;
/** New documents take the reference Tonio canvas (toonio.ru draws 1280×720). */
export const CANVAS_LOGICAL_WIDTH = 1280;
export const CANVAS_LOGICAL_HEIGHT = 720;

/** Fixed-point multiplier: 1 logical px = 8 document units. */
export const FIXED_POINT_SCALE = 8;

/** Default canvas size in document units (10240×5760 — fits int16). */
export const DEFAULT_DOC_WIDTH = CANVAS_LOGICAL_WIDTH * FIXED_POINT_SCALE;
export const DEFAULT_DOC_HEIGHT = CANVAS_LOGICAL_HEIGHT * FIXED_POINT_SCALE;

/** Frame rate defaults; player range is 5–24 (5 = the original Multator tempo). */
export const DEFAULT_FPS = 12;
export const PLAYER_FPS_MIN = 5;
export const PLAYER_FPS_MAX = 24;

/**
 * The row of dots of the Multator panel, in logical pixels — which is what a
 * width is everywhere: a pixel is a pixel, and no document rescales it. The
 * reference's own 2, 4, 6, 10, 20 were measured on its 600-wide canvas; here
 * they are ×1280/600, rounded, so the line is the width it always was on the
 * canvas this editor opens with.
 */
export const BRUSH_SIZES_LOGICAL = [4, 9, 13, 21, 43] as const;
/** The reference's starting 4 of that canvas. */
export const DEFAULT_BRUSH_SIZE_LOGICAL = 9;
export const DEFAULT_BRUSH_COLOR = '#000000';
/** Second color of the Tonio palette (`fill`, right mouse button). */
export const DEFAULT_FILL_COLOR = '#ff0000';
/**
 * Bounds a stored width is kept inside, in logical px. The ceiling is the
 * widest a brush may declare — the Multator cap of 300 on its 600-wide
 * canvas, which is 640 here; a brush's own `range` stops the slider earlier.
 */
export const MIN_BRUSH_SIZE_LOGICAL = 1;
export const MAX_BRUSH_SIZE_LOGICAL = 640;

/** Canvas background color. */
export const BACKGROUND_COLOR = '#ffffff';

/**
 * Onion-skin depth: neighbor opacities by distance from the active frame,
 * nearest first. Two levels of real-color ghosting (0.3 then 0.1), applied
 * to both previous and next frames — the classic frame-by-frame light table.
 */
export const ONION_SKIN_ALPHAS = [0.3, 0.1] as const;

/** Tonio's onion: ladder over the last visited frames, topping out here. */
export const ONION_HISTORY_MAX_ALPHA = 0.15;
/** How many visited frames Tonio keeps in that history. */
export const ONION_HISTORY_LENGTH = 3;

/**
 * Lang simplification: the reference's tolerance, in pixels of its own
 * 600-wide canvas. The brush that thins with it scales it to the editor's
 * canvas itself — rounding it here would be visible in the line.
 */
export const LANG_LOOK_AHEAD = 5;
export const LANG_TOLERANCE_LOGICAL = 10;
/** That tolerance in document units of a document of the reference's width. */
export const LANG_TOLERANCE_DOC = LANG_TOLERANCE_LOGICAL * FIXED_POINT_SCALE;

/**
 * The one limit a mult is drawn against: its weight. A point weighs 1, a
 * stroke 3 more (what its record costs in the file beside its points) and a
 * cell — a frame of a layer — 10, so an empty frame is not free. The server
 * counts the same way; the publish caps are sized so a full budget is sent.
 */
export const MAX_DOCUMENT_WEIGHT = 1_000_000;
export const STROKE_WEIGHT = 3;
export const CELL_WEIGHT = 10;

/** Schema limits — keep in sync with toon-v1.schema.json (asserted in tests). */
export const MAX_DOC_DIMENSION = 32767;
/**
 * Stroke coordinates are int16 and may lie outside the canvas: a stroke
 * can leave the canvas and come back (the renderer clips visually).
 */
export const STROKE_COORD_MIN = -32768;
export const STROKE_COORD_MAX = 32767;
/** Layers per document (v3); the Toonio reference caps at the same number. */
export const MAX_LAYERS = 20;
export const MAX_STROKES_PER_FRAME = 16384;
/** Layer name length (v5); the reference's `MAX_LAYER_NAME`. */
export const MAX_LAYER_NAME = 12;

/**
 * A layer name cut to `MAX_LAYER_NAME` without splitting a character: a slice
 * through an emoji left half of it, a lone surrogate that JSON writes as
 * `\ud83d` and the API's parser refuses — the mult would not publish. A lone
 * half already in the text (a `.toon` stores UTF-16 words) becomes U+FFFD.
 */
export function cutLayerName(text: string): string {
  return cutText(text, MAX_LAYER_NAME);
}

/** Any name cut to `max` UTF-16 units by the same rule (a workspace's too). */
export function cutText(text: string, max: number): string {
  let cut = text.slice(0, max);
  if (/[\uD800-\uDBFF]$/.test(cut)) {
    cut = cut.slice(0, -1);
  }
  return wellFormed(cut);
}

/** Every lone surrogate half as U+FFFD (`toWellFormed`, which Safari 16 lacks). */
export function wellFormed(text: string): string {
  return text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, (unit) => (unit.length === 2 ? unit : '\uFFFD'));
}

/** Maximum coordinate count (x,y flat) per stroke. */
export const MAX_STROKE_COORDS = 65536;
/**
 * The widest stored line: the widest brush any preset may declare, so the
 * whole of every scale draws what it says (Multator's 640 is 640 px).
 */
export const MAX_STROKE_WIDTH = MAX_BRUSH_SIZE_LOGICAL * FIXED_POINT_SCALE;

/**
 * Export resolutions, by width (the reference's row, `export_help.js:61`).
 * The height follows the document's own proportion — see `exportSize`.
 */
export const EXPORT_WIDTHS = [640, 1280, 1920, 2560] as const;
export const EXPORT_DEFAULT_WIDTH = 1280;
