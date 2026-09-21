/**
 * The plugin the editor ships with: everything it needs to reproduce
 * multator.ru and toonio.ru, and nothing else.
 *
 * Six tools, two brush types and two presets. It travels with the editor and
 * is built with it, but it is not *of* it: nothing under `lib/` imports this
 * folder, the editor draws with its own brush under its own `toonop` preset,
 * and everything here reaches the editor through the plugin contract — the
 * same door an installed plugin comes through. Taking it out would cost the
 * editor two presets and five brushes, not a line of its own code.
 *
 * It cannot be switched off or removed, which is the one way it differs from
 * a plugin somebody installs: it is the delivery, not a choice.
 *
 * Nothing here invents a primitive: every brush lays down one the format
 * already has and the renderer already draws (`pencil`, `eraser`, `stamp`,
 * `contour`, `contour-eraser`), so the player, the export and a published
 * cartoon draw these strokes with no plugin code anywhere near them.
 */

import { FIXED_POINT_SCALE } from '../lib/format/constants';
import { SQUARE_STAMP } from '../lib/format/types';
import {
  PLUGIN_API,
  type Plugin,
  type PluginPrimitive,
  type PluginTool,
  type StrokeRules,
} from '../lib/plugins/contract';
import { ERASER_ICON, PENCIL_ICON, PIXEL_ICON } from './icons';
import { MULTATOR_RULES } from './multator';
import { OLDSCHOOL_LANG_TOLERANCE_LOGICAL, commitOldschoolStroke } from './oldschool-geometry';
import { appendPixelCells, pixelPrepare } from './pixel-geometry';
import { PRESETS } from './presets';
import { toonioRules } from './toonio';

// ---------------------------------------------------------------------------
// The multator line
// ---------------------------------------------------------------------------

/** Nothing of its own: the everyday brush with the multator canvas fixed. */
const MULTATOR_PENCIL: PluginPrimitive = {
  kind: 'pencil',
  rules: () => MULTATOR_RULES,
  descriptor: ({ width, color }) => ({ kind: 'pencil', geometry: 'smooth', width, color }),
};

const MULTATOR_ERASER: PluginPrimitive = {
  kind: 'eraser',
  rules: () => MULTATOR_RULES,
  descriptor: ({ width }) => ({ kind: 'eraser', geometry: 'smooth', width }),
};

// ---------------------------------------------------------------------------
// The oldschool pen
// ---------------------------------------------------------------------------

/**
 * Lang tolerance, contour, jitter: logical pixels of the document, the same
 * ones the slider counts in. Nothing here is scaled by the document's size.
 */
const oldschoolCommit: NonNullable<StrokeRules['commit']> = (points, descriptor) => ({
  points: commitOldschoolStroke(
    points,
    // The descriptor carries document units; the contour wants the width.
    descriptor.width / FIXED_POINT_SCALE,
    Math.random,
    OLDSCHOOL_LANG_TOLERANCE_LOGICAL * FIXED_POINT_SCALE,
  ),
  // A contour carries one colour and no fill, so the pen paints and the
  // eraser punches — which is the whole of this brush type's vocabulary.
  tool: descriptor.kind === 'eraser'
    ? { kind: 'contour-eraser', geometry: 'smooth' }
    : { kind: 'contour', geometry: 'smooth', color: 'color' in descriptor ? descriptor.color : '#000000' },
});

/**
 * The pen collects a line the way the multator brush does, but owns what it
 * becomes — and takes nothing from the release event (reference
 * `onOldEndDraw` adds no point of its own).
 *
 * No `cut` on the tools below. The mega eraser reads the stored descriptor,
 * and a closed filled contour already goes whole by itself; declaring a
 * policy on a brush of kind `pencil` would instead describe every pencil
 * stroke in the document, since the eraser looks a policy up by primitive.
 */
const oldschoolRules = (): StrokeRules => ({
  ...MULTATOR_RULES,
  release: (line) => [...line],
  prepare: undefined,
  commit: oldschoolCommit,
});

const OLDSCHOOL_PEN: PluginPrimitive = {
  kind: 'pencil',
  rules: oldschoolRules,
  descriptor: ({ width, color }) => ({ kind: 'pencil', geometry: 'smooth', width, color }),
};

const OLDSCHOOL_ERASER: PluginPrimitive = {
  kind: 'eraser',
  rules: oldschoolRules,
  descriptor: ({ width }) => ({ kind: 'eraser', geometry: 'smooth', width }),
};

// ---------------------------------------------------------------------------
// The tonio line, and the pixel that measures on its canvas
// ---------------------------------------------------------------------------

/** The brush the Toonio preset hands a tool that named no canvas of its own. */
const TOONIO_BRUSH: PluginPrimitive = {
  kind: 'pencil',
  rules: ({ smooth, minDistance }) => toonioRules({ smooth, minDistance }),
  descriptor: ({ width, color }) => ({ kind: 'pencil', geometry: 'smooth', width, color }),
};

const PIXEL: PluginPrimitive = {
  kind: 'stamp',
  grid: true,
  // Cells are independent marks, so the eraser takes the ones it covered and
  // leaves the rest standing on the grid.
  cut: 'cells',
  descriptor: ({ width, color }) => ({
    kind: 'stamp',
    geometry: 'line',
    width,
    color,
    shape: [...SQUARE_STAMP],
  }),
  // The marks are its own: another brush's smoothing would bend a row of
  // cells into a line the renderer has nothing to draw with.
  rules: () => ({
    range: { min: 1, max: 500 },
    defaults: { width: 5, smooth: 3, minDistance: 3 },
    // Neither number reaches it: Smooth is the identity here and Prepare
    // thins by the tool width instead.
    smoothing: false,
    capture: (line, points, width) => appendPixelCells(line, points, width),
    prepare: (points, width, zoom) => pixelPrepare(points, width, zoom),
  }),
};

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------

/** A twin asks for no key and stands on no panel: the brush box is its door. */
const twin = (label: string, icon: string, stroke: PluginPrimitive): PluginTool => ({
  label,
  title: label,
  key: '',
  icon,
  offPanel: true,
  stroke,
});

const plugin: Plugin = {
  id: 'core',
  api: PLUGIN_API,
  name: 'Внутренний',
  version: '1.0.0',
  description: 'Кисти, пресеты и прочее необязательное, что приезжает с редактором — тем же контрактом, что и любой плагин.',
  tools: {
    'multator-pencil': twin('Мультаторовский карандаш', PENCIL_ICON, MULTATOR_PENCIL),
    'multator-eraser': twin('Мультаторовский ластик', ERASER_ICON, MULTATOR_ERASER),
    oldschool: twin('Старое перо', PENCIL_ICON, OLDSCHOOL_PEN),
    'oldschool-eraser': twin('Старый ластик', ERASER_ICON, OLDSCHOOL_ERASER),
    'toonio-brush': twin('Тониовская кисть', PENCIL_ICON, TOONIO_BRUSH),
    pixel: {
      label: 'Пиксель',
      title: 'Пиксель — рисует по сетке',
      key: '',
      icon: PIXEL_ICON,
      stroke: PIXEL,
    },
  },
  brushTypes: {
    /**
     * The reference hid the pen behind the word `old` typed on the keyboard
     * and kept it as a flag on the session. Here each type is a pair of
     * brushes of the register, and the brush box picks between them and the
     * everyday pair.
     */
    old: {
      label: 'Старая',
      hint: 'Контур переменной толщины, как старым пером',
      twins: { pencil: 'oldschool', eraser: 'oldschool-eraser' },
    },
    multator: {
      label: 'Мультатор',
      hint: 'Сглаженная, дрожь руки почти не видно',
      twins: { pencil: 'multator-pencil', eraser: 'multator-eraser' },
    },
  },
  presets: PRESETS,
};

export default plugin;
