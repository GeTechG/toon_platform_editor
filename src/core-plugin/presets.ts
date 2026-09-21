/**
 * The two presets this plugin brings: what the editor behaves like when it is
 * reproducing multator.ru or toonio.ru.
 *
 * A preset is data — the UX profile whole, the brush it hands a tool that
 * named none of its own, the brush type it opens with, and a patch on the one
 * arrangement. The editor holds none of it: it knows only its own `toonop`.
 */

import type { PluginPreset, UxProfile } from '../lib/plugins/contract';

import { DEFAULT_FPS, PLAYER_FPS_MAX, PLAYER_FPS_MIN } from '../lib/format/constants';

/** ToolPanel.hx draws these three and nothing else. */
const MULTATOR_TOOLS: readonly string[] = ['pencil', 'eraser', 'pipette'];
/** tools.js: ERASER, PENCIL, FEATHER, MEGAERASER, plus the picker — no pixel button. */
const TONIO_TOOLS: readonly string[] = [
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

/**
 * toonio.ru: onion over the last visited frames, a saved colour grid, fps
 * 1–30, a pipette that previews while it moves, brush up to 500.
 */
const TOONIO_UX: UxProfile = {
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
  // The reference draws into a 1280×720 bitmap and lets the browser scale it.
  canvasDensity: 'document',
  projectFile: true,
  onionMode: 'history',
  colorGrid: true,
  fpsRange: [1, 30],
  livePipettePreview: true,
  crossCursor: true,
  tools: TONIO_TOOLS,
};

const MULTATOR_UX: UxProfile = {
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
  canvasDensity: 'device',
  projectFile: false,
  onionMode: 'neighbors',
  colorGrid: false,
  fpsRange: [PLAYER_FPS_MIN, PLAYER_FPS_MAX],
  livePipettePreview: false,
  crossCursor: false,
  tools: MULTATOR_TOOLS,
};

/** The keys the reference draws, in its own order (`ToolPanel.hx`). */
const MULTATOR_KEYS = MULTATOR_TOOLS.map((tool) => `tool:${tool}`);

export const PRESETS: Readonly<Record<string, PluginPreset>> = {
  multator: {
    label: 'Multator',
    // Its line is a brush type of its own, so opening the preset is picking
    // it: the multator canvas, whatever tool is in hand.
    brush: 'multator-pencil',
    brushType: 'multator',
    ux: MULTATOR_UX,
    // The reference is a smaller editor and keeps everything under the
    // canvas: frames, then the transport, then the drawing row — two colours
    // instead of the palette box, a row of dots instead of the sliders, and
    // none of the keys it never had (sound, GIF export, cell clipboard).
    //
    // Each line sits where the reference put it. The strip's line holds only
    // what acts on frames — `+` and `×` right beside it. The next line opens
    // on play and ends on the send button, with what the reference had no key
    // for (fullscreen, the gear) between them and the save note last. The
    // saves, undo, onion and fps stay on the shelf, a gesture away.
    // The drawing line reads left to right the way the reference drew it:
    // the tools, then the row of dots, then the two colour squares.
    panels: {
      base: {
        rows: [
          ['add-frame', 'delete-frame', 'timeline'],
          ['transport', 'fullscreen', 'settings', 'saved', 'publish'],
          [...MULTATOR_KEYS, 'brush-sizes', 'color'],
        ],
      },
    },
  },
  toonio: {
    label: 'Toonio',
    brush: 'toonio-brush',
    ux: TOONIO_UX,
  },
};
