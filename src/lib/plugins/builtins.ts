/**
 * The tools the editor ships with, as manifests.
 *
 * They go through the same register as anything loaded from outside — a
 * separate door "for ours" would leave the contract untested by the people who
 * use it every day. `icon` here is a name from the editor's vocabulary
 * (`Icon.svelte`); a plugin, which cannot write into that file, brings markup
 * instead, and the two are told apart by the leading `<`.
 */

import { multatorPlugins } from './brush-types';
import { PLUGIN_API, type Plugin, type PluginPrimitive } from './contract';
import { distortPlugin } from './distort';
import { oldschoolPlugins } from './oldschool';
import { pixelPlugin } from './pixel';

/**
 * The three line primitives of the format, as the editor's own tools lay them
 * down. They go through the same block a plugin fills in: the points are read
 * as the one smooth chain, and the eraser cuts them as polylines — which is
 * the default, so none of that is spelled out.
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

/** In the order the rail draws them. */
export const BUILTIN_TOOLS: readonly Plugin[] = [
  {
    id: 'pencil',
    api: PLUGIN_API,
    tool: { icon: 'pencil', title: 'Карандаш (B)', label: 'Карандаш', key: 'B', stroke: PENCIL },
  },
  {
    id: 'eraser',
    api: PLUGIN_API,
    tool: { icon: 'eraser', title: 'Ластик (E)', label: 'Ластик', key: 'E', stroke: ERASER },
  },
  {
    id: 'feather',
    api: PLUGIN_API,
    tool: {
      icon: 'feather',
      title: 'Перо (F) — обводка и заливка',
      label: 'Перо',
      key: 'F',
      stroke: FEATHER,
    },
  },
  {
    id: 'mega-eraser',
    api: PLUGIN_API,
    tool: {
      icon: 'mega-eraser',
      title: 'Мега-ластик (Alt+E) — режет линии целиком',
      label: 'Мега-ластик',
      key: 'Alt+E',
    },
  },
  {
    id: 'pipette',
    api: PLUGIN_API,
    tool: {
      icon: 'pipette',
      title: 'Пипетка (P) — ещё раз: взять цвет с экрана',
      label: 'Пипетка',
      key: 'P',
      help: true,
    },
  },
  {
    id: 'drag',
    api: PLUGIN_API,
    tool: { icon: 'hand', title: 'Рука (D) — двигать холст', label: 'Рука', key: 'D', help: true },
  },
  {
    id: 'lasso',
    api: PLUGIN_API,
    tool: { icon: 'lasso', title: 'Лассо (Q) — взять кадр и трансформировать', label: 'Лассо', key: 'Q', help: true },
  },
  distortPlugin,
  pixelPlugin,
  ...oldschoolPlugins,
  ...multatorPlugins,
];

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
