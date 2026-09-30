/**
 * The types the brush in hand can be switched to.
 *
 * A type is never a flag on the session: it picks another brush of the
 * register, and that brush says for itself which canvas it draws on and what
 * its points become. «Обычная» is the editor's own and means «no twins»;
 * every other type is a register record a plugin brought.
 */

import { plugins } from './index';
import { t } from '../i18n';
import type { PluginBrushType } from './contract';

/** The id of a brush type; `normal` is the editor's own. */
export type BrushType = string;

export const NORMAL_BRUSH_TYPE = 'normal';

/**
 * The twin a type names for this tool, if the register holds it. A twin whose
 * plugin never came (or broke), or that is not a name at all, is no form of
 * the tool: the canvas fell back to a plain pencil for it — an eraser drew ink.
 */
function twinOf(type: PluginBrushType | undefined, tool: string): string | undefined {
  const twin: unknown = type && Object.hasOwn(type.twins, tool) ? type.twins[tool] : undefined;
  return typeof twin === 'string' && plugins.tool(twin) ? twin : undefined;
}

/** Whether the tool in hand has other forms at all (the feather has none). */
export function hasBrushTypes(tool: string): boolean {
  return plugins.brushTypes().some((type) => twinOf(type, tool));
}

/** Every type offered for this tool, the everyday one first. */
export function brushTypesFor(tool: string): { id: BrushType; label: string; hint: string }[] {
  return [
    { id: NORMAL_BRUSH_TYPE, label: t('brush_type.normal.label'), hint: t('brush_type.normal.hint') },
    ...plugins.brushTypes().filter((type) => twinOf(type, tool)).map((type) => ({
      id: type.id,
      label: type.label,
      hint: type.hint ?? '',
    })),
  ];
}

/**
 * Which brush actually draws: the tool in hand, or the twin of the picked
 * type. A tool with no such form keeps drawing its own line whatever the type
 * says — the choice is only offered where there is something to switch to.
 */
export function brushOfType(tool: string, type: BrushType): string {
  return type === NORMAL_BRUSH_TYPE ? tool : twinOf(plugins.brushType(type), tool) ?? tool;
}
