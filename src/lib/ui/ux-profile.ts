/**
 * The editor's own UX profile: everything a preset changes about how the
 * editor *behaves* beyond the line its brush draws (that lives in
 * `tools/brush.ts`). Pure data + pure functions, so `bun test` covers the
 * branching and the runes state stays a thin caller.
 *
 * Only `toonop` is here. A preset that reproduces somebody else's editor
 * brings its own profile in its plugin — the editor holds no table of them.
 */

import type { UxProfile } from '../plugins/contract';
import { DEFAULT_FPS, MIN_BRUSH_SIZE_LOGICAL } from '../format/constants';

export type { UxProfile };

/**
 * Toonop started from the Tonio toolbar and keeps the pixel tool the
 * reference never showed. The pixel comes from the shipped plugin; naming it
 * here costs nothing when it is absent — a tool the register does not hold is
 * simply not placed.
 */
const TOONOP_TOOLS: readonly string[] = [
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

/**
 * The editor's own mode: it took the toonio.ru behaviour whole, then went on
 * by itself. Every value is written out here, never read from a parity
 * profile, so a parity fix never moves toonop and vice versa.
 */
export const TOONOP_UX: UxProfile = {
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
  // The thick end in a few presses (owner, 12th audit): 1 → 500 was 499.
  adaptiveBrushStep: 'ladder',
  canvasDensity: 'device',
  projectFile: false,
  onionMode: 'history',
  colorGrid: true,
  fpsRange: [1, 30],
  livePipettePreview: true,
  crossCursor: true,
  tools: TOONOP_TOOLS,
};

/** Photoshop's bracket ladder: [below this size, the step]. */
const LADDER: readonly (readonly [number, number])[] = [
  [10, 1], [50, 5], [100, 10], [200, 25], [300, 50], [Infinity, 100],
];

/** Brush size after a +/- nudge (dir = ±1) under the profile's stepping rule. */
export function nudgeBrushSize(size: number, dir: 1 | -1, ux: UxProfile): number {
  let step = 1;
  if (ux.adaptiveBrushStep === 'ladder') {
    // Photoshop's [ and ]: going down takes the step of the band below, so
    // 10 − is 9 and 50 − is 45; an odd size lands on the next rung.
    const rung = LADDER.find(([below]) => (dir > 0 ? size : size - 1) < below)![1];
    const next = dir > 0 ? Math.floor(size / rung) * rung + rung : Math.ceil(size / rung) * rung - rung;
    return Math.min(ux.brushSizeMax, Math.max(MIN_BRUSH_SIZE_LOGICAL, next));
  }
  if (ux.adaptiveBrushStep) {
    // The reference's ladder (1 below 10, 5 below 50, 10 above) measured on
    // its 600-wide canvas; on the editor's 1280 that is ×2.13(3), rounded to
    // numbers a hand can read.
    step = size < 20 ? 2 : size < 100 ? 10 : 20;
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
  tool: string,
  color: string,
  ux: UxProfile,
  paletteExpanded = true,
  available: readonly string[] = ux.tools,
): string | null {
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

/**
 * The drawing tool a help tool hands back (reference `ResetHelpTool`). An
 * eraser is not something a picked colour can be used with, so it becomes the
 * pencil; everything else returns as it was.
 */
export function toolAfterHelp(previous: string): string {
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
