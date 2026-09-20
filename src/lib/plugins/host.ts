/**
 * What the editor hands a plugin.
 *
 * Two rules live here rather than in any plugin: the document is written back
 * by the editor (so coordinates are clamped whatever a plugin did with them),
 * and a gesture is one step of undo however many times the plugin wrote by
 * the way. A plugin that could spoil the history is a plugin that will.
 */

import { clampCoord } from '../model/geom';
import { TONIO_CANVAS_WIDTH } from '../tools/profiles';
import type { Stroke } from '../format/types';
import type { PluginHost, PluginStroke } from './contract';

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
 */
export function editCells(
  cells: readonly EditableCell[],
  fn: (strokes: PluginStroke[]) => void,
): Stroke[][] {
  const copies = cells.map((cell) => cell.strokes.map((stroke) => ({ ...stroke, points: [...stroke.points] })));
  const flat = copies.flat() as PluginStroke[];
  fn(flat);
  let at = 0;
  return copies.map((cell) => cell.map(() => {
    const stroke = flat[at++];
    return { ...stroke, points: stroke.points.map(clampCoord) } as Stroke;
  }));
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
export function makeHost(owner: HostOwner): PluginHost {
  return {
    window: ({ title }) => owner.openPluginWindow(title),
    strokes: () => owner.pluginStrokes(),
    edit: (fn) => owner.editPluginCells(fn),
    // The reference measures on its own 1280-wide canvas; a document of any
    // other size is converted here rather than in every plugin.
    referencePx: (value) => value * TONIO_CANVAS_WIDTH / owner.doc.width,
  };
}
