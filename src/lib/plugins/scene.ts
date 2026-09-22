/**
 * The document as an export format reads it.
 *
 * A format gets numbers and a way to have a cell drawn — never the document
 * itself, and never a second reader of its geometry. The cell is drawn by the
 * renderer the player uses, onto whatever canvas the format brings.
 */

import { BACKGROUND_COLOR } from '../format/constants';
import type { ToonDocument } from '../format/types';
import { frameCount } from '../model/operations';
import { renderStrokesLayer, type Canvas2DLike } from '../render/canvas2d';
import type { PluginScene } from './contract';

/** Document units in, document units out: the format scales as it likes. */
const DOCUMENT_UNITS = { scale: 1, dpr: 1 };

export function makeScene(doc: ToonDocument, frame: number): PluginScene {
  const visible = doc.layers.filter((layer) => !layer.hidden);
  return {
    width: doc.width,
    height: doc.height,
    frameRate: doc.frame_rate,
    frames: frameCount(doc),
    frame,
    background: BACKGROUND_COLOR,
    layers: visible.length,
    draw(layer, at, target) {
      const cell = visible[layer]?.frames[at];
      if (cell) {
        // The renderer asks for the whole Canvas2DLike, but a cell reaches
        // only the part the contract names.
        renderStrokesLayer(cell, doc.tools, target as unknown as Canvas2DLike, DOCUMENT_UNITS);
      }
    },
  };
}
