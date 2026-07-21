/**
 * Frame rendering contract. Everything else (tools, timeline, player,
 * UI) never touches the Canvas API — only this contract. It is the seam
 * for swapping the render backend (WebGL) and the reuse point for the
 * phase-2 player and GIF export.
 */

import type { Frame, ToolDescriptor } from '../format/types';

export interface Viewport {
  /** CSS pixels per document unit. */
  scale: number;
  /** devicePixelRatio of the target screen. */
  dpr: number;
}

/** Stateless frame renderer: a pure function of frame and viewport. */
export interface FrameRenderer<TTarget> {
  render(frame: Frame, tools: readonly ToolDescriptor[], target: TTarget, viewport: Viewport): void;
}
