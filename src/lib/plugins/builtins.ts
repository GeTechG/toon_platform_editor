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
  pencil: { icon: 'pencil', title: t('tool.pencil.title'), label: t('tool.pencil.label'), key: 'B', stroke: PENCIL },
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
  // The pixel draws on a grid nobody asked for until they ask: the profile
  // holds it, the rail starts without it, and a key from the shelf brings it.
  panels: { hide: ['tool:pixel'] },
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
  'Enter', 'Escape', 'Delete', 'F7', ' ',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Ctrl+S', 'Alt+S', 'Alt+Enter', 'Alt+L',
];
