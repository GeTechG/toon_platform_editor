/**
 * The selection's own clipboard: what an open transform holds, copied out of
 * the frame, put back into it as a new floating selection, or taken away.
 * The timeline copies whole cells; this copies the part the frame shows
 * inside the handles.
 */

import type { ToonDocument } from '../format/types';
import { cloneFrame, internTool, pressureOf, replaceStrokes, type ResolvedStroke } from '../model/operations';
import { bakeCopy, type BakedTransform } from './bake-transform';
import type { LassoCut } from './lasso';

/** A copied part, per layer it came from; tools resolved, so it outlives the tool table. */
export type CopiedPart = { layer: number; strokes: ResolvedStroke[] }[];

/**
 * The selected strokes as the canvas shows them now — cut at the loop,
 * moved, turned, scaled, with the width the scale gave them. The document
 * is not touched.
 */
export function copyPart(doc: ToonDocument, frame: number, open: BakedTransform): CopiedPart {
  const baked = bakeCopy(doc, frame, open);
  return open.layers.map((layer, at) => {
    const cell = baked.layers[layer].frames[frame];
    const cut = open.picked?.[at];
    const strokes = cut ? cut.indices.map((index) => cell.strokes[index]) : cell.strokes;
    return { layer, strokes: cloneFrame(baked, { strokes }).strokes };
  });
}

/**
 * Delete over a selection, written into one of its cells: the pieces the loop
 * took go, the pieces it left outside stay where they lie. A whole cell taken
 * by Q is emptied.
 */
export function eraseSelected(doc: ToonDocument, layer: number, frame: number, open: BakedTransform): void {
  const cut = open.picked?.[open.layers.indexOf(layer)];
  const taken = new Set(cut?.indices);
  replaceStrokes(doc, layer, frame, cut ? cut.strokes.filter((_, index) => !taken.has(index)) : []);
}

/**
 * V: the part laid back over the frame as a selection of its own, each
 * layer's strokes on the layer `layerFor` names. Nothing of the cells
 * changes — the pieces wait in `picked` on top of what the cells hold, and
 * land with the applied transform, moved or not. Only the tool table grows,
 * with the tools the part brought along.
 */
export function pastePart(
  doc: ToonDocument,
  frame: number,
  part: CopiedPart,
  layerFor: (layer: number) => number,
): { layers: number[]; picked: LassoCut[]; pasted: true } {
  const byLayer = new Map<number, LassoCut>();
  for (const { layer, strokes } of part) {
    const target = layerFor(layer);
    let cut = byLayer.get(target);
    if (!cut) {
      cut = { strokes: doc.layers[target].frames[frame].strokes.map((s) => ({ ...s, points: s.points.slice() })), indices: [] };
      byLayer.set(target, cut);
    }
    for (const stroke of strokes) {
      cut.indices.push(cut.strokes.length);
      cut.strokes.push({ points: stroke.points.slice(), tool_id: internTool(doc, stroke.tool), ...pressureOf(stroke) });
    }
  }
  const layers = [...byLayer.keys()].sort((a, b) => a - b);
  return { layers, picked: layers.map((layer) => byLayer.get(layer)!), pasted: true };
}
