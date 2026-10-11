import type { ToonDocument } from '../format/types';
import type { Box } from '../model/geom';
import { replaceStrokes, transformStrokes } from '../model/operations';
import { sessionMatrix, sessionWidthScale, type LassoCut, type TransformSession } from './lasso';

/** What of an open transform the drawing needs: which cells, from where, how far. */
export interface BakedTransform {
  layers: readonly number[];
  box: Box;
  session: TransformSession;
  widthWithScale: boolean;
  /**
   * What a loop took of each of `layers`, in their order: the cell cut at the
   * loop, and the pieces to move. Absent — the whole cell moves, uncut.
   */
  picked?: readonly LassoCut[];
}

/**
 * Writes the open transform into one of its cells. A loop's cut lands here
 * too, with the move and never before it: a selection put back untouched
 * leaves every line whole.
 */
export function writeTransform(doc: ToonDocument, layer: number, frame: number, open: BakedTransform): void {
  const cut = open.picked?.[open.layers.indexOf(layer)];
  if (cut) {
    replaceStrokes(doc, layer, frame, cut.strokes);
  }
  transformStrokes(
    doc, layer, frame, cut?.indices ?? null,
    sessionMatrix(open.session, open.box),
    open.widthWithScale ? sessionWidthScale(open.session) : 1,
  );
}

/**
 * The drawing as it would be with the open transform applied — without
 * applying it. The draft written when the tab goes to the background takes
 * this, and the live selection stays in the hand. The document itself is not
 * touched: only the moved cells, their layers and the tool list are copied,
 * everything else is shared. An unmoved selection gives the document back.
 */
export function bakeTransform(doc: ToonDocument, frame: number, open: BakedTransform): ToonDocument {
  const { session } = open;
  if (session.dx === 0 && session.dy === 0 && session.rotate === 0
    && session.scaleX === 1 && session.scaleY === 1) {
    return doc;
  }
  const moved = new Set(open.layers);
  const copy: ToonDocument = {
    ...doc,
    tools: [...doc.tools],
    layers: doc.layers.map((layer, index) => moved.has(index)
      ? { ...layer, frames: layer.frames.map((cell, at) => (at === frame ? { ...cell, strokes: [...cell.strokes] } : cell)) }
      : layer),
  };
  for (const layer of moved) {
    writeTransform(copy, layer, frame, open);
  }
  return copy;
}
