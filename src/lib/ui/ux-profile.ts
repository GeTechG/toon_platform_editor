/**
 * UX profile of a toolbar preset: everything a preset changes about how the
 * editor *behaves* beyond the stroke algorithm (which lives in
 * tools/profiles.ts). Pure data + pure functions, so `bun test` covers the
 * branching and the runes state stays a thin caller.
 *
 * `multator` reproduces the reference multator.ru editor (Main.hx /
 * DrawField.hx / ToolPanel.hx), `toonio` the reference toonio.ru editor
 * (toonio.bundle.js / tools.js / editor.html); `toonop` is the editor's own
 * behavior.
 */

import {
  DEFAULT_FPS,
  MIN_BRUSH_SIZE_LOGICAL,
  PLAYER_FPS_MAX,
  PLAYER_FPS_MIN,
} from '../format/constants';

export type UxProfileId = 'toonop' | 'multator' | 'toonio';
export type SelectableTool =
  | 'pencil'
  | 'eraser'
  | 'pipette'
  | 'feather'
  | 'pixel'
  | 'mega-eraser'
  /** Hand: drags the canvas under a zoom window (reference `Drag`). */
  | 'drag'
  /** Lasso: takes the frame on every selected layer and opens the transform window. */
  | 'lasso'
  /** Distort: shakes the frame's points as the pointer travels (reference `Distort`). */
  | 'distort';

const BASE_TOOLS: readonly SelectableTool[] = ['pencil', 'eraser', 'pipette'];
/**
 * Toonop started from the Tonio toolbar and keeps the pixel tool the
 * reference never showed. Spelled out rather than built from TONIO_TOOLS:
 * toonop is ours to change without moving the parity preset.
 */
const TOONOP_TOOLS: readonly SelectableTool[] = [
  'pencil',
  'eraser',
  'feather',
  'mega-eraser',
  'pipette',
  'drag',
  'lasso',
  'distort',
  'pixel',
];
/** Toonop's own brush ceiling, inherited from the Tonio slider. */
const TOONOP_MAX_BRUSH_SIZE_LOGICAL = 500;
/** tools.js: ERASER, PENCIL, FEATHER, MEGAERASER, plus the picker — no pixel button. */
const TONIO_TOOLS: readonly SelectableTool[] = [
  'pencil',
  'eraser',
  'feather',
  'mega-eraser',
  'pipette',
  'drag',
  'lasso',
  'distort',
];

/** Tonio's brush ceiling (editor.html slider max). */
const TONIO_MAX_BRUSH_SIZE_LOGICAL = 500;

export interface UxProfile {
  /** Two-swatch quick palette shown while the full picker is collapsed; null = always the full picker. */
  readonly quickPalette: readonly string[] | null;
  /** White is the eraser marker: choosing it (or the pencil while white) arms the eraser. */
  readonly whiteIsEraser: boolean;
  /** The pipette is only offered while the full palette is expanded. */
  readonly pipetteNeedsPalette: boolean;
  /**
   * The pipette is not a rail button: the reference keeps it in the palette's
   * foot alone (`E:205-208`). It stays reachable by P and by that button.
   */
  readonly pipetteOffRail: boolean;
  /** Which neighbors the onion skin shows (only read in the 'neighbors' mode). */
  readonly onionSides: 'both' | 'previous';
  /** Onion model: fading neighbors, or Tonio's last visited frames. */
  readonly onionMode: 'neighbors' | 'history';
  /** A persistent grid of saved colors next to the picker (Tonio). */
  readonly colorGrid: boolean;
  /** Allowed player fps range. */
  readonly fpsRange: readonly [number, number];
  /** The pipette follows the pointer with a live color swatch (Tonio). */
  readonly livePipettePreview: boolean;
  /** Cursor draws a crosshair for very thin and very thick brushes (Tonio). */
  readonly crossCursor: boolean;
  /** Tools the preset's starting arrangement places, in toolbar order. */
  readonly tools: readonly SelectableTool[];
  /** Opacity the active frame (with its live stroke) is composited at. */
  readonly activeFrameAlpha: number;
  /** Which neighbor becomes active after deleting a frame. */
  readonly afterRemove: 'next' | 'previous';
  /** Playback starts from the first frame instead of the active one. */
  readonly playFromStart: boolean;
  /**
   * What Space plays: the whole document, or (Tonio) the frame selection when
   * it spans more than one frame — with a one-frame document refusing to play.
   */
  readonly playbackRange: 'document' | 'selection';
  /** Where a new layer lands relative to the active one; Ctrl inverts it. */
  readonly newLayerPosition: 'above' | 'below';
  /** A new stroke leaves the redo buffer alone (Tonio) instead of clearing it. */
  readonly redoSurvivesStroke: boolean;
  /** Frame rate a fresh document gets under this preset. */
  readonly defaultFps: number;
  /** Upper bound for the +/- brush nudge (logical px). */
  readonly brushSizeMax: number;
  /** Adaptive +/- step (1 below 10, 5 below 50, else 10) instead of a flat 1. */
  readonly adaptiveBrushStep: boolean;
}

export const UX_PROFILES: Readonly<Record<UxProfileId, UxProfile>> = {
  // The editor's own mode: it took the toonio.ru behaviour whole, then went on
  // by itself. Every value is written out here, never read from `toonio`, so a
  // parity fix there never moves toonop and vice versa.
  toonop: {
    quickPalette: null,
    whiteIsEraser: false,
    pipetteNeedsPalette: false,
    pipetteOffRail: true,
    onionSides: 'both',
    activeFrameAlpha: 1,
    afterRemove: 'next',
    playFromStart: false,
    playbackRange: 'selection',
    newLayerPosition: 'below',
    redoSurvivesStroke: true,
    defaultFps: DEFAULT_FPS,
    brushSizeMax: TOONOP_MAX_BRUSH_SIZE_LOGICAL,
    adaptiveBrushStep: false,
    onionMode: 'history',
    colorGrid: true,
    fpsRange: [1, 30],
    livePipettePreview: true,
    crossCursor: true,
    tools: TOONOP_TOOLS,
  },
  // toonio.ru: onion over the last visited frames, saved color grid, fps 1–30,
  // a pipette that previews while it moves, brush up to 500.
  toonio: {
    quickPalette: null,
    whiteIsEraser: false,
    pipetteNeedsPalette: false,
    pipetteOffRail: true,
    onionSides: 'both',
    activeFrameAlpha: 1,
    afterRemove: 'next',
    playFromStart: false,
    playbackRange: 'selection',
    newLayerPosition: 'below',
    redoSurvivesStroke: true,
    defaultFps: DEFAULT_FPS,
    brushSizeMax: TONIO_MAX_BRUSH_SIZE_LOGICAL,
    adaptiveBrushStep: false,
    onionMode: 'history',
    colorGrid: true,
    fpsRange: [1, 30],
    livePipettePreview: true,
    crossCursor: true,
    tools: TONIO_TOOLS,
  },
  multator: {
    // ToolPanel.hx: pc1 = 0x000000, pc2 = 0xFF0000; the full picker is behind M.
    quickPalette: ['#000000', '#ff0000'],
    whiteIsEraser: true,
    pipetteNeedsPalette: true,
    pipetteOffRail: false,
    // DrawField.hx: backContainerSprite (0.3) and backContainerSprite2 (0.1)
    // hold the previous frames; containerSprite.alpha = 0.8 is the drawing.
    onionSides: 'previous',
    activeFrameAlpha: 0.8,
    // Main.hx onDelFrame: curFrame-- unless already at 0.
    afterRemove: 'previous',
    // Main.hx onPlayMovie: playFrame = 0.
    playFromStart: true,
    playbackRange: 'document',
    newLayerPosition: 'above',
    redoSurvivesStroke: false,
    // draw31.fla stage is 30 fps, doPlay runs every 6th tick → 5 fps.
    defaultFps: 5,
    // DrawField.setPenSize(_, delta): clamp 1..300 with adaptive steps.
    brushSizeMax: 300,
    adaptiveBrushStep: true,
    onionMode: 'neighbors',
    colorGrid: false,
    fpsRange: [PLAYER_FPS_MIN, PLAYER_FPS_MAX],
    livePipettePreview: false,
    crossCursor: false,
    tools: BASE_TOOLS,
  },
};

/** Brush size after a +/- nudge (dir = ±1) under the profile's stepping rule. */
export function nudgeBrushSize(size: number, dir: 1 | -1, ux: UxProfile): number {
  let step = 1;
  if (ux.adaptiveBrushStep) {
    step = size < 10 ? 1 : size < 50 ? 5 : 10;
  }
  const next = size + dir * step;
  return Math.min(ux.brushSizeMax, Math.max(MIN_BRUSH_SIZE_LOGICAL, next));
}

/**
 * The tool that actually becomes active when the user asks for `tool` with
 * the current brush color; null when the request is not available (pipette
 * without the expanded palette).
 *
 * `available` is what the arrangement offers right now (panels.ts
 * `visibleTools`); without one, the profile's own starting set stands in.
 */
export function resolveToolSelection(
  tool: SelectableTool,
  color: string,
  ux: UxProfile,
  paletteExpanded = true,
  available: readonly SelectableTool[] = ux.tools,
): SelectableTool | null {
  if (!available.includes(tool)) {
    return null;
  }
  if (tool === 'pipette' && ux.pipetteNeedsPalette && !paletteExpanded) {
    return null;
  }
  if (tool === 'pencil' && ux.whiteIsEraser && isWhite(color)) {
    return 'eraser';
  }
  return tool;
}

/** Tools that interrupt drawing instead of replacing it (reference `helpTool`). */
const HELP_TOOLS: readonly SelectableTool[] = ['pipette', 'drag', 'lasso', 'distort'];

export function isHelpTool(tool: SelectableTool): boolean {
  return HELP_TOOLS.includes(tool);
}

/**
 * The drawing tool a help tool hands back (reference `ResetHelpTool`). An
 * eraser is not something a picked colour can be used with, so it becomes the
 * pencil; everything else returns as it was.
 */
export function toolAfterHelp(previous: SelectableTool): SelectableTool {
  return previous === 'eraser' || previous === 'mega-eraser' ? 'pencil' : previous;
}

/** Tool to switch to after picking `color`; null when the profile leaves the tool alone. */
export function toolAfterColorChange(color: string, ux: UxProfile): 'pencil' | 'eraser' | null {
  if (!ux.whiteIsEraser) {
    return null;
  }
  return isWhite(color) ? 'eraser' : 'pencil';
}

function isWhite(color: string): boolean {
  return color.toLowerCase() === '#ffffff';
}
