/**
 * Format constants and editor defaults.
 *
 */

/** Supported document schema version. */
export const SCHEMA_VERSION = 1;
export const CANVAS_LOGICAL_WIDTH = 600;
export const CANVAS_LOGICAL_HEIGHT = 300;

/** Fixed-point multiplier: 1 logical px = 8 document units. */
export const FIXED_POINT_SCALE = 8;

/** Default canvas size in document units (4800×2400 — fits int16). */
export const DEFAULT_DOC_WIDTH = CANVAS_LOGICAL_WIDTH * FIXED_POINT_SCALE;
export const DEFAULT_DOC_HEIGHT = CANVAS_LOGICAL_HEIGHT * FIXED_POINT_SCALE;

/** Frame rate defaults; MVP player range is 12–24. */
export const DEFAULT_FPS = 12;
export const PLAYER_FPS_MIN = 12;
export const PLAYER_FPS_MAX = 24;

/** Brush: in logical canvas px. */
export const BRUSH_SIZES_LOGICAL = [2, 4, 6, 10, 20] as const;
export const DEFAULT_BRUSH_SIZE_LOGICAL = 4;
export const DEFAULT_BRUSH_COLOR = '#000000';
/** Bounds for the +/- brush-size nudge (logical canvas px, 1-unit steps). */
export const MIN_BRUSH_SIZE_LOGICAL = 1;
export const MAX_BRUSH_SIZE_LOGICAL = 200;

/** Canvas background color. */
export const BACKGROUND_COLOR = '#ffffff';

/**
 * Format-reserved eraser marker: a stroke with this color erases layer
 * alpha (destination-out) instead of painting. White is unreachable as a
 * drawing color by construction — on the opaque white background the two
 * are indistinguishable anyway.
 */
export const ERASER_COLOR = '#ffffff';

/**
 * Onion-skin depth: neighbor opacities by distance from the active frame,
 * nearest first. Two levels of real-color ghosting (0.3 then 0.1), applied
 * to both previous and next frames — the classic frame-by-frame light table.
 */
export const ONION_SKIN_ALPHAS = [0.3, 0.1] as const;

/** Local-draft autosave debounce (ms). */
export const DRAFT_SAVE_DEBOUNCE_MS = 500;

/** Lang simplification: tolerance in logical px. */
export const LANG_LOOK_AHEAD = 5;
export const LANG_TOLERANCE_LOGICAL = 10;
/** Lang tolerance in document units. */
export const LANG_TOLERANCE_DOC = LANG_TOLERANCE_LOGICAL * FIXED_POINT_SCALE;

/** Semantic limit: total number of points in a document. */
export const MAX_TOTAL_POINTS = 1_000_000;

/** Schema limits — keep in sync with toon-v1.schema.json (asserted in tests). */
export const MAX_DOC_DIMENSION = 32767;
/**
 * Stroke coordinates are int16 and may lie outside the canvas: a stroke
 * can leave the canvas and come back (the renderer clips visually).
 */
export const STROKE_COORD_MIN = -32768;
export const STROKE_COORD_MAX = 32767;
export const MAX_FRAMES = 4096;
export const MAX_STROKES_PER_FRAME = 16384;
/** Maximum coordinate count (x,y flat) per stroke. */
export const MAX_STROKE_COORDS = 65536;
export const MAX_STROKE_WIDTH = 4800;
