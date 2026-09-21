/**
 * The types the brush in hand can be switched to.
 *
 * A type is never a flag on the session: it picks another brush of the
 * register, and that brush says for itself which canvas it draws on and what
 * its points become. «Обычная» is the editor's own and means «no twins»;
 * every other type is a register record a plugin brought.
 */

import { plugins } from './index';

/** The id of a brush type; `normal` is the editor's own. */
export type BrushType = string;

export const NORMAL_BRUSH_TYPE = 'normal';

/** Whether the tool in hand has other forms at all (the feather has none). */
export function hasBrushTypes(tool: string): boolean {
  return plugins.brushTypes().some((type) => tool in type.twins);
}

/** Every type offered for this tool, the everyday one first. */
export function brushTypesFor(tool: string): { id: BrushType; label: string; hint: string }[] {
  return [
    { id: NORMAL_BRUSH_TYPE, label: 'Обычная', hint: 'Точнее, гладкость настраивается' },
    ...plugins.brushTypes().filter((type) => tool in type.twins).map((type) => ({
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
  return type === NORMAL_BRUSH_TYPE ? tool : plugins.brushType(type)?.twins[tool] ?? tool;
}
