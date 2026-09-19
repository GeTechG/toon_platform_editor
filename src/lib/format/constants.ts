/**
 * Format constants and editor defaults.
 *
 */

/** Version the editor writes; older ones are migrated on load. */
export const SCHEMA_VERSION = 5;
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
 * Brush sizes, in pixels of the dialect's own reference canvas (Multator's
 * 600-wide one) — `canvasCoordinateScale` maps them onto the document.
 */
export const BRUSH_SIZES_LOGICAL = [2, 4, 6, 10, 20] as const;
export const DEFAULT_BRUSH_SIZE_LOGICAL = 4;
export const DEFAULT_BRUSH_COLOR = '#000000';
/** Second color of the Tonio palette (`fill`, right mouse button). */
export const DEFAULT_FILL_COLOR = '#ff0000';
/** Bounds for the +/- brush-size nudge (logical canvas px; 300 = reference cap). */
export const MIN_BRUSH_SIZE_LOGICAL = 1;
export const MAX_BRUSH_SIZE_LOGICAL = 300;

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
/** Layers per document (v3); the Toonio reference caps at the same number. */
export const MAX_LAYERS = 20;
export const MAX_STROKES_PER_FRAME = 16384;
/** Layer name length (v5); the reference's `MAX_LAYER_NAME`. */
export const MAX_LAYER_NAME = 12;
/** Maximum coordinate count (x,y flat) per stroke. */
export const MAX_STROKE_COORDS = 65536;
export const MAX_STROKE_WIDTH = 4800;

/**
 * Export resolutions, by width (the reference's row, `export_help.js:61`).
 * The height follows the document's own proportion — see `exportSize`.
 */
export const EXPORT_WIDTHS = [640, 1280, 1920, 2560] as const;
export const EXPORT_DEFAULT_WIDTH = 1280;
