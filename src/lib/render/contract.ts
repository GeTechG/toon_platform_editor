/**
 * Frame rendering contract. Everything else (tools, timeline, player,
 * UI) never touches the Canvas API — only this contract. It is the seam
 * for swapping the render backend (WebGL) and the reuse point for the
 * phase-2 player and GIF export.
 */

import type { ToonDocument } from '../format/types';

export interface Viewport {
  /** CSS pixels per document unit. */
  scale: number;
  /** devicePixelRatio of the target screen. */
  dpr: number;
}

/**
 * Frame renderer: a frame of the document is the composite of the cells of
 * its visible layers, so the renderer takes the document and a frame index —
 * not a single cell. Deterministic for a given document, index and viewport.
 */
export interface FrameRenderer<TTarget> {
  render(doc: ToonDocument, frameIndex: number, target: TTarget, viewport: Viewport): void;
}
