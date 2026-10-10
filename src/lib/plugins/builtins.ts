/**
 * The tools the editor ships with, as one manifest.
 *
 * It goes through the same register as anything loaded from outside — a
 * separate door "for ours" would leave the contract untested by the people who
 * use it every day. `icon` here is a name from the editor's vocabulary
 * (`Icon.svelte`); a plugin, which cannot write into that file, brings markup
 * instead, and the two are told apart by the leading `<`.
 */

import { toonopRules } from '../tools/brush';
import { PLUGIN_API, type Plugin, type PluginPreset, type PluginPrimitive, type PluginTool } from './contract';
import { distortTool } from './distort';
import { TOONOP_UX } from '../ui/ux-profile';
import { t } from '../i18n';

/**
 * The three line primitives of the format, as the editor's own tools lay them
 * down. They go through the same block a plugin fills in: the points are read
 * as the one smooth chain, and the eraser cuts them as polylines — which is
 * the default, so none of that is spelled out. None of them declares rules:
 * they draw by the brush the preset named, which is what "the everyday pencil
 * follows the panel" means.
 */
export const PENCIL: PluginPrimitive = {
  kind: 'pencil',
  descriptor: ({ width, color }) => ({ kind: 'pencil', geometry: 'smooth', width, color }),
};
const ERASER: PluginPrimitive = {
  kind: 'eraser',
  descriptor: ({ width }) => ({ kind: 'eraser', geometry: 'smooth', width }),
};
/** The same line, filled before it is stroked. */
const FEATHER: PluginPrimitive = {
  kind: 'feather',
  descriptor: ({ width, color, fill }) => ({ kind: 'feather', geometry: 'smooth', width, color, fill }),
};

/** The editor's own brush: nobody takes it in hand, the preset points at it. */
const TOONOP_BRUSH: PluginPrimitive = {
  kind: 'pencil',
  rules: toonopRules,
  descriptor: ({ width, color }) => ({ kind: 'pencil', geometry: 'smooth', width, color }),
};

/** In the order the rail draws them. */
const TOOLS: Readonly<Record<string, PluginTool>> = {
  pencil: { icon: 'brush', title: t('tool.pencil.title'), label: t('tool.pencil.label'), key: 'B', stroke: PENCIL },
  eraser: { icon: 'eraser', title: t('tool.eraser.title'), label: t('tool.eraser.label'), key: 'E', stroke: ERASER },
  feather: {
    icon: 'feather',
    title: t('tool.feather.title'),
    label: t('tool.feather.label'),
    key: 'F',
    stroke: FEATHER,
  },
  'mega-eraser': {
    icon: 'mega-eraser',
    title: t('tool.mega_eraser.title'),
    label: t('tool.mega_eraser.label'),
    key: 'Alt+E',
  },
  pipette: {
    icon: 'pipette',
    title: t('tool.pipette.title'),
    label: t('tool.pipette.label'),
    key: 'P',
    help: true,
  },
  drag: { icon: 'hand', title: t('tool.hand.title'), label: t('tool.hand.label'), key: 'D', help: true },
  lasso: {
    icon: 'transform',
    title: t('tool.transform.title'),
    label: t('tool.transform.label'),
    key: 'Q',
    help: true,
  },
  distort: distortTool,
  'toonop-brush': {
    icon: 'pencil',
    title: t('tool.editor_brush.title'),
    label: t('tool.editor_brush.label'),
    key: '',
    offPanel: true,
    stroke: TOONOP_BRUSH,
  },
};

/** The editor's own preset — the only one it holds; the rest come from plugins. */
const TOONOP_PRESET: PluginPreset = {
  label: 'Toonop',
  brush: 'toonop-brush',
  ux: TOONOP_UX,
  // Its own arrangement, a desk's (owner, 2026-10-10: the one after
  // Procreate Dreams was a tablet's): the tools down the left, as desk
  // programs stand them, with the brush's thickness under them; toonop's
  // own colours open on the right, where a cursor has the room — no window
  // over the sheet — and the brush box under them (owner, the same day). On the bar over
  // the canvas, at its near end, what the film leaves by — send, draft,
  // export — then undo, redo and the save note; at its far end the studio's
  // own: the gear, help, full screen. Over the strip what times the film:
  // the rate, «+», the transport, the onion, the sound. On the shelf, a key
  // away, what is rarely pressed — the pixel, the distort, the drafts. A
  // phone keeps its own cut (small-screen.ts). The one default arrangement
  // stays the reference presets'.
  panels: {
    base: {
      left: [
        'tool:pencil',
        'tool:eraser',
        'tool:feather',
        'tool:mega-eraser',
        'tool:pipette',
        'tool:drag',
        'tool:lasso',
        'brush-rail',
      ],
      right: ['colours', 'brush'],
      top: ['publish', 'save', 'export', 'history', 'saved', 'spring', 'settings', 'manual', 'fullscreen'],
      rows: [['fps', 'add-frame', 'transport', 'onion', 'audio'], ['timeline']],
    },
  },
};

export const BUILTIN_PLUGIN: Plugin = {
  id: 'toonop',
  api: PLUGIN_API,
  tools: TOOLS,
  presets: { toonop: TOONOP_PRESET },
};

/**
 * Keys the editor holds for itself, so a plugin cannot quietly take one.
 * The tool keys above are not here: they are claimed by registering.
 */
export const RESERVED_KEYS: readonly string[] = [
  'a', 'c', 'h', 'j', 'k', 'l', 'm', 'o', 's', 'v', 'w', 'x', 'y', 'z',
  '+', '-', '=', '_', '`',
  'Enter', 'Escape', 'Delete', 'Backspace', 'F7', ' ',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Ctrl+S', 'Ctrl+X', 'Alt+S', 'Alt+L',
];
