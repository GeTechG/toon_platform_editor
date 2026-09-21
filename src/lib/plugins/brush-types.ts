/**
 * The types the brush in hand can be switched to, and the brushes they
 * resolve to.
 *
 * A type is never a flag on the session: it picks another brush of the
 * register, and that brush says for itself which canvas it draws on and what
 * its points become. «Старая» is the oldschool pen (`oldschool.ts`, its own
 * geometry); «Мультатор» is the plain multator line — the same brush the
 * Multator preset holds, in whatever preset it is picked.
 */

import { PLUGIN_API, type Plugin, type PluginPrimitive } from './contract';
import { OLDSCHOOL_TWIN } from './oldschool';

/** Nothing of its own: the everyday brush with the multator canvas fixed. */
const MULTATOR_PENCIL: PluginPrimitive = {
  kind: 'pencil',
  dialect: 'multator',
  descriptor: ({ width, color }) => ({ kind: 'pencil', dialect: 'multator', width, color }),
};

const MULTATOR_ERASER: PluginPrimitive = {
  kind: 'eraser',
  dialect: 'multator',
  descriptor: ({ width }) => ({ kind: 'eraser', dialect: 'multator', width }),
};

/** Neither brush asks for a key: the brush box is the door. */
export const multatorPlugins: readonly Plugin[] = [
  {
    id: 'multator-pencil',
    api: PLUGIN_API,
    tool: {
      icon: 'pencil',
      title: 'Мультаторовский карандаш',
      label: 'Мультаторовский карандаш',
      key: '',
      offPanel: true,
      stroke: MULTATOR_PENCIL,
    },
  },
  {
    id: 'multator-eraser',
    api: PLUGIN_API,
    tool: {
      icon: 'eraser',
      title: 'Мультаторовский ластик',
      label: 'Мультаторовский ластик',
      key: '',
      offPanel: true,
      stroke: MULTATOR_ERASER,
    },
  },
];

/** Which brush stands in for which everyday one, per type. */
const MULTATOR_TWIN: Readonly<Record<string, string>> = {
  pencil: 'multator-pencil',
  eraser: 'multator-eraser',
};

export type BrushType = 'normal' | 'old' | 'multator';

const TWINS: Readonly<Record<Exclude<BrushType, 'normal'>, Readonly<Record<string, string>>>> = {
  old: OLDSCHOOL_TWIN,
  multator: MULTATOR_TWIN,
};

/** Whether the tool in hand has other forms at all (the feather and the pixel do not). */
export function hasBrushTypes(tool: string): boolean {
  return tool in OLDSCHOOL_TWIN;
}

/**
 * Which brush actually draws: the tool in hand, or the twin of the picked
 * type. A tool with no such form keeps drawing its own line whatever the type
 * says — the choice is only offered where there is something to switch to.
 */
export function brushOfType(tool: string, type: BrushType): string {
  return type === 'normal' ? tool : TWINS[type][tool] ?? tool;
}
