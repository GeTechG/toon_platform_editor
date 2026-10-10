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

/**
 * What toonop started with before, whole: an arrangement stored while it was
 * the start is nobody's own, and follows today's (presets.ts `parseUiConfig`).
 * Until 2026-10-10 a config held the arrangement always, touched or not.
 */
export const FORMER_TOONOP_PANELS: readonly NonNullable<PluginPreset['panels']>[] = [
  // 2026-10-05 – 2026-10-10: the one after Procreate Dreams.
  {
    base: {
      left: ['brush-rail', 'history'],
      right: [],
      top: [
        'publish', 'save', 'export', 'audio', 'onion', 'settings', 'manual', 'fullscreen', 'saved', 'spring',
        'tool:pencil', 'tool:eraser', 'tool:feather', 'tool:mega-eraser', 'tool:pipette', 'tool:drag', 'tool:lasso',
        'color-key',
      ],
      rows: [['fps', 'add-frame', 'transport'], ['timeline']],
    },
  },
];

/** The editor's own preset — the only one it holds; the rest come from plugins. */
const TOONOP_PRESET: PluginPreset = {
  label: 'Toonop',
  brush: 'toonop-brush',
  ux: TOONOP_UX,
  // Its own arrangement, a desk's (owner, 2026-10-10: the one after
  // Procreate Dreams was a tablet's): the tools down the left, as desk
  // programs stand them, undo and redo under them (owner, the same day);
  // on the right, where a
  // cursor has the room, toonop's own colours open — no window over the
  // sheet — and nothing else. The brush, its thickness too, is behind its
  // tool's key, pressed again or with the right button (owner, the same
  // day: the box and the colours together were taller than any laptop's
  // column, and a slider or a key of it beside them was a leftover). No bar
  // over the canvas: it stood mostly empty and took the sheet's height
  // (owner, the same day). Over the strip, at the near end, what times the
  // film: the rate, «+», the transport, the onion, the sound; at the far
  // end the save note, the draft and export, the studio's
  // own — the gear, help, full screen — and «Отправить» last. On the
  // shelf, a key away, what is rarely pressed — the pixel, the distort, the
  // drafts. A phone keeps its own cut (small-screen.ts). The one default
  // arrangement stays the reference presets'.
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
        'history',
      ],
      right: ['colours'],
      top: [],
      rows: [
        ['fps', 'add-frame', 'transport', 'onion', 'audio', 'spring', 'saved', 'save', 'export', 'settings', 'manual', 'fullscreen', 'publish'],
        ['timeline'],
      ],
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
