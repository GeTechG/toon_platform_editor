import type { ToonDocument } from '../format/types';
import type { Box } from '../model/geom';
import { transformStrokes } from '../model/operations';
import { sessionMatrix, sessionWidthScale, type TransformSession } from './lasso';

/** What of an open transform the drawing needs: which cells, from where, how far. */
export interface BakedTransform {
  layers: readonly number[];
  box: Box;
  session: TransformSession;
  widthWithScale: boolean;
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
  const widthScale = open.widthWithScale ? sessionWidthScale(session) : 1;
  const matrix = sessionMatrix(session, open.box);
  for (const layer of moved) {
    transformStrokes(copy, layer, frame, null, matrix, widthScale);
  }
  return copy;
}
