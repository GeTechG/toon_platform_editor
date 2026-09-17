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
import type { ToonDocument } from '../lib/format/types';
import { frameCount } from '../lib/model/operations';
import {
  blitLayer,
  Canvas2DFrameRenderer,
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

export class FrameCompositor {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  readonly #renderer = new Canvas2DFrameRenderer();
  /** Onion neighbors of the active layer, same bounded cache as the editor. */
  readonly #onion = new Map<string, HTMLCanvasElement>();

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
    if (!doc.layers[0]?.frames[displayedFrame]) {
      return;
    }

    if (showOnionSkin) {
      // Onion first, then the frame composite over it (same order as the editor).
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = BACKGROUND_COLOR;
      ctx.fillRect(0, 0, pxW, pxH);
      for (const layer of onionLayers(activeFrame, frameCount(doc), ONION_SKIN_ALPHAS)) {
        const el = this.#onionCell(doc, layer.index, pxW, pxH, viewport);
        if (!el) {
          continue;
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = layer.alpha;
        ctx.drawImage(el, 0, 0);
      }
      ctx.globalAlpha = 1;
      const composite = this.#frameComposite(doc, displayedFrame, pxW, pxH, viewport);
      blitLayer(composite, ctx);
    } else {
      this.#renderer.render(doc, displayedFrame, ctx, viewport);
    }

    if (live && live.points.length >= 2) {
      renderRawPolyline(live.points, live.width, live.color, ctx, viewport);
    }
  }

  /** The visible composite of a frame, rendered off-screen so onion stays under it. */
  #frameComposite(
    doc: ToonDocument,
    frame: number,
    pxW: number,
    pxH: number,
    viewport: Viewport,
  ): HTMLCanvasElement {
    this.#compositeEl ??= document.createElement('canvas');
    const el = this.#compositeEl;
    if (el.width !== pxW) el.width = pxW;
    if (el.height !== pxH) el.height = pxH;
    this.#renderer.render(doc, frame, el.getContext('2d') as unknown as Canvas2DLike, viewport);
    return el;
  }

  #compositeEl: HTMLCanvasElement | null = null;

  /** Neighbor cell of layer 0 — the active layer in every bench run. */
  #onionCell(
    doc: ToonDocument,
    frame: number,
    pxW: number,
    pxH: number,
    viewport: Viewport,
  ): HTMLCanvasElement | null {
    const cell = doc.layers[0]?.frames[frame];
    if (!cell || cell.strokes.length === 0) {
      return null;
    }
    const key = `${frame}:${cell.strokes.length}:${pxW}x${pxH}`;
    const cached = this.#onion.get(key);
    if (cached) {
      return cached;
    }
    const el = document.createElement('canvas');
    el.width = pxW;
    el.height = pxH;
    const lctx = el.getContext('2d') as unknown as LayerCtx;
    lctx.clearRect(0, 0, pxW, pxH);
    renderStrokesLayer(cell, doc.tools, lctx, viewport);
    this.#onion.set(key, el);
    while (this.#onion.size > ONION_SKIN_ALPHAS.length * 2) {
      this.#onion.delete(this.#onion.keys().next().value as string);
    }
    return el;
  }
}

type ViewCtx = Canvas2DLike & {
  globalAlpha: number;
  drawImage(image: CanvasImageSource, dx: number, dy: number): void;
};
type LayerCtx = Canvas2DLike & { clearRect(x: number, y: number, w: number, h: number): void };
