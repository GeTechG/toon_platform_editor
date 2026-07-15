/**
 * Frame compositor for the benchmark: reproduces the editor's on-screen draw
 * so latency/fps numbers reflect real render cost.
 *
 * ponytail: this mirrors the orchestration of CanvasView.draw (background →
 * onion layers → active layer → live polyline) — but the expensive work
 * (renderStrokesLayer / blitLayer / renderRawPolyline / the per-frame layer
 * cache) is IMPORTED from the same modules the editor uses, not re-implemented.
 * If this drifts from CanvasView, extract a shared composeFrame() there and
 * call it from both — that's the upgrade path, not worth it for ~20 lines now.
 */

import { BACKGROUND_COLOR, ONION_SKIN_ALPHAS } from '../lib/format/constants';
import type { Frame, ToonDocument } from '../lib/format/types';
import {
  blitLayer,
  renderRawPolyline,
  renderStrokesLayer,
  type Canvas2DLike,
} from '../lib/render/canvas2d';
import type { Viewport } from '../lib/render/contract';
import { onionLayers } from '../lib/ui/frame-selection';

export interface LiveStroke {
  points: readonly number[];
  width: number;
  color: string;
}

interface LayerCache {
  el: HTMLCanvasElement | null;
  strokeCount: number;
  w: number;
  h: number;
}

export class FrameCompositor {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  readonly #layers = new WeakMap<Frame, LayerCache>();

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D context unavailable');
    }
    this.#ctx = ctx;
  }

  compose(
    doc: ToonDocument,
    displayedFrame: number,
    activeFrame: number,
    showOnionSkin: boolean,
    live: LiveStroke | null,
  ): void {
    const ctx = this.#ctx as unknown as ViewCtx;
    const pxW = this.#canvas.width;
    const pxH = this.#canvas.height;
    // dpr folded into the pixel count: k = scale × dpr = pxW / doc.width.
    const viewport: Viewport = { scale: pxW / doc.width, dpr: 1 };
    const frame = doc.frames[displayedFrame];
    if (!frame) {
      return;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BACKGROUND_COLOR;
    ctx.fillRect(0, 0, pxW, pxH);

    if (showOnionSkin) {
      for (const layer of onionLayers(activeFrame, doc.frames.length, ONION_SKIN_ALPHAS)) {
        const neighbor = doc.frames[layer.index];
        if (neighbor.strokes.length === 0) {
          continue;
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = layer.alpha;
        ctx.drawImage(this.#frameLayer(neighbor, pxW, pxH, viewport), 0, 0);
      }
      ctx.globalAlpha = 1;
    }

    blitLayer(this.#frameLayer(frame, pxW, pxH, viewport), ctx);
    if (live && live.points.length >= 2) {
      renderRawPolyline(live.points, live.width, live.color, ctx, viewport);
    }
  }

  #frameLayer(frame: Frame, pxW: number, pxH: number, viewport: Viewport): HTMLCanvasElement {
    let cache = this.#layers.get(frame);
    if (!cache) {
      cache = { el: null, strokeCount: -1, w: 0, h: 0 };
      this.#layers.set(frame, cache);
    }
    if (!cache.el || cache.strokeCount !== frame.strokes.length || cache.w !== pxW || cache.h !== pxH) {
      cache.el ??= document.createElement('canvas');
      cache.el.width = pxW;
      cache.el.height = pxH;
      const lctx = cache.el.getContext('2d') as unknown as LayerCtx;
      lctx.clearRect(0, 0, pxW, pxH);
      renderStrokesLayer(frame, lctx, viewport);
      cache.strokeCount = frame.strokes.length;
      cache.w = pxW;
      cache.h = pxH;
    }
    return cache.el;
  }
}

type ViewCtx = Canvas2DLike & {
  globalAlpha: number;
  drawImage(image: CanvasImageSource, dx: number, dy: number): void;
};
type LayerCtx = Canvas2DLike & { clearRect(x: number, y: number, w: number, h: number): void };
