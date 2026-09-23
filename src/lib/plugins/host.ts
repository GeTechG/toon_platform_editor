/**
 * What the editor hands a plugin.
 *
 * Two rules live here rather than in any plugin: the document is written back
 * by the editor (so coordinates are clamped whatever a plugin did with them),
 * and a gesture is one step of undo however many times the plugin wrote by
 * the way. A plugin that could spoil the history is a plugin that will.
 */

import { clampCoord } from '../model/geom';
import { MAX_STROKE_COORDS } from '../format/constants';
import type { Stroke, ToolDescriptor } from '../format/types';
import { PRESSURE_MAX } from '../render/pressure';
import { pluginNamespace, type PluginHost, type PluginStroke } from './contract';
import { translator } from '../i18n';

export interface EditableCell {
  readonly strokes: readonly Stroke[];
}

/**
 * The strokes of `cells`, flat and in cell order, for the plugin to rewrite;
 * back come the new strokes of each cell, in the same shape.
 *
 * The plugin rewrites what is there — strokes it adds to or drops from the
 * list are not written back. The contract has no way to say "this one is
 * gone" yet, and guessing from the length would delete the wrong stroke.
 *
 * What comes back is the plugin's word, so only its geometry is taken: the
 * points, and the pressure while it still has one value per point. A field of
 * its own, another tool or points the document cannot hold (odd, empty, half
 * a curve) would make a draft that never opens again — that stroke stays as
 * it was instead.
 */
export function editCells(
  cells: readonly EditableCell[],
  fn: (strokes: PluginStroke[]) => void,
  tools: readonly ToolDescriptor[] = [],
): Stroke[][] {
  const copies = cells.map((cell) => cell.strokes.map((stroke) => ({ ...stroke, points: [...stroke.points] })));
  const flat = copies.flat() as PluginStroke[];
  fn(flat);
  let at = 0;
  return copies.map((cell, c) => cell.map((_, s) => written(cells[c].strokes[s], flat[at++], tools)));
}

function written(was: Stroke, got: PluginStroke | undefined, tools: readonly ToolDescriptor[]): Stroke {
  const raw: unknown = got?.points;
  const count = Array.isArray(raw) ? raw.length : 0;
  const cubic = tools[was.tool_id]?.geometry === 'cubic';
  if (count < 2 || count % 2 !== 0 || count > MAX_STROKE_COORDS || (cubic && (count - 2) % 6 !== 0)) {
    return { ...was, points: [...was.points] };
  }
  const points = (raw as unknown[]).map((value) => clampCoord(Number(value)));
  const stroke: Stroke = { points, tool_id: was.tool_id };
  const pressure: unknown = got?.pressure;
  if (Array.isArray(pressure) && pressure.length === count / 2) {
    stroke.pressure = pressure.map((q) => Math.min(PRESSURE_MAX, Math.max(0, Math.round(Number(q)) || 0)));
  }
  return stroke;
}

/** The narrow view of the editor a host is built over — never the state itself. */
export interface HostOwner {
  readonly doc: { width: number };
  pluginStrokes(): PluginStroke[];
  editPluginCells(fn: (strokes: PluginStroke[]) => void): void;
  openPluginWindow(title: string): HTMLElement;
}

/**
 * Builds the object a plugin is handed. It carries no runes state: reactivity
 * does not cross this boundary (plugins share a runtime with each other, not
 * with the editor), so the contract hands over data and takes callbacks.
 */
export function makeHost(owner: HostOwner, plugin: string): PluginHost {
  return {
    t: translator(pluginNamespace(plugin)),
    window: ({ title }) => owner.openPluginWindow(title),
    strokes: () => owner.pluginStrokes(),
    edit: (fn) => owner.editPluginCells(fn),
  };
}
