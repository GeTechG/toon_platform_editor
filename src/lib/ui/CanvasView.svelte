<script lang="ts">
  import type { EditorState } from './editor-state.svelte';
  import { BACKGROUND_COLOR, CANVAS_LOGICAL_WIDTH, ONION_SKIN_ALPHAS } from '../format/constants';
  import type { Frame } from '../format/types';
  import { addStroke } from '../model/operations';
  import type { Viewport } from '../render/contract';
  import {
    blitLayer,
    renderRawPolyline,
    renderStrokesLayer,
    type BlitTarget,
    type Canvas2DLike,
  } from '../render/canvas2d';
  import { onionLayers } from './frame-selection';
  import { StrokeBuilder, brushWidthDoc } from '../tools/stroke-builder';

  let { editor }: { editor: EditorState } = $props();

  // The visible context needs a few more members than the pure Canvas2DLike/
  // BlitTarget seam (alpha compositing, clearing). It is a real 2D context.
  type ViewCtx = Canvas2DLike &
    BlitTarget & { globalAlpha: number; clearRect(x: number, y: number, w: number, h: number): void };
  type LayerCtx = Canvas2DLike & { clearRect(x: number, y: number, w: number, h: number): void };
  type LayerCache = { el: HTMLCanvasElement | null; strokeCount: number; w: number; h: number };

  let canvasEl: HTMLCanvasElement;
  let wrapWidth = $state(CANVAS_LOGICAL_WIDTH);
  let wrapHeight = $state(0);
  let builder: StrokeBuilder | null = null;
  let rafPending = false;
  // One transparent, real-color strokes layer per frame (keyed by frame
  // identity), re-rendered only when its stroke count or the pixel size
  // changes. The active frame and every onion neighbor composite from these —
  // onion is the same drawing, just blitted at a lower globalAlpha.
  const frameLayers = new WeakMap<Frame, LayerCache>();

  // Fit inside the wrap: capped by width, by height (when known), and by the logical max.
  const cssWidth = $derived(
    Math.max(
      1,
      Math.min(
        wrapWidth || CANVAS_LOGICAL_WIDTH,
        CANVAS_LOGICAL_WIDTH,
        wrapHeight > 0 ? wrapHeight * (editor.doc.width / editor.doc.height) : Infinity,
      ),
    ),
  );
  const cssHeight = $derived(cssWidth * (editor.doc.height / editor.doc.width));

  /** Cached transparent layer with the frame's strokes in their real colors. */
  function frameLayer(frame: Frame, pxW: number, pxH: number, viewport: Viewport): HTMLCanvasElement {
    let cache = frameLayers.get(frame);
    if (!cache) {
      cache = { el: null, strokeCount: -1, w: 0, h: 0 };
      frameLayers.set(frame, cache);
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

  function draw(): void {
    if (!canvasEl) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const pxWidth = Math.max(1, Math.round(cssWidth * dpr));
    const pxHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (canvasEl.width !== pxWidth) {
      canvasEl.width = pxWidth;
    }
    if (canvasEl.height !== pxHeight) {
      canvasEl.height = pxHeight;
    }
    const ctx = canvasEl.getContext('2d') as unknown as ViewCtx;
    const viewport = { scale: cssWidth / editor.doc.width, dpr };
    const frames = editor.doc.frames;
    const frame = frames[editor.displayedFrame];
    if (!frame) {
      return;
    }

    // Background once, then transparent stroke layers on top.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BACKGROUND_COLOR;
    ctx.fillRect(0, 0, pxWidth, pxHeight);

    // Onion-skin: previous/next neighbors under the active frame in their real
    // colors, fading with distance (farthest first so nearer frames sit on top).
    if (editor.showOnionSkin) {
      for (const layer of onionLayers(editor.activeFrame, frames.length, ONION_SKIN_ALPHAS)) {
        const neighbor = frames[layer.index];
        if (neighbor.strokes.length === 0) {
          continue;
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = layer.alpha;
        ctx.drawImage(frameLayer(neighbor, pxWidth, pxHeight, viewport), 0, 0);
      }
      ctx.globalAlpha = 1;
    }

    // Active frame over onion (fully opaque), then the live stroke.
    blitLayer(frameLayer(frame, pxWidth, pxHeight, viewport), ctx);
    if (builder) {
      renderRawPolyline(builder.rawPoints, builder.brush.width, builder.brush.color, ctx, viewport);
    }
  }

  function scheduleDraw(): void {
    if (rafPending) {
      return;
    }
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      draw();
    });
  }

  $effect(() => {
    // Redraw dependencies: size, displayed frame and its strokes, onion
    // toggle and the neighbor frames it composites (up to the onion depth
    // on each side).
    void cssWidth;
    void editor.displayedFrame;
    void editor.doc.frames[editor.displayedFrame]?.strokes.length;
    void editor.showOnionSkin;
    const active = editor.activeFrame;
    for (let distance = 1; distance <= ONION_SKIN_ALPHAS.length; distance++) {
      void editor.doc.frames[active - distance]?.strokes.length;
      void editor.doc.frames[active + distance]?.strokes.length;
    }
    scheduleDraw();
  });

  function toDocUnits(e: { clientX: number; clientY: number }): [number, number] {
    const rect = canvasEl.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * editor.doc.width;
    const y = ((e.clientY - rect.top) / rect.height) * editor.doc.height;
    return [x, y];
  }

  function onPointerDown(e: PointerEvent): void {
    if (editor.playing || !e.isPrimary || builder) {
      return;
    }
    canvasEl.setPointerCapture(e.pointerId);
    builder = new StrokeBuilder({
      width: brushWidthDoc(editor.brushSizeLogical),
      color: editor.brushColor,
    });
    const [x, y] = toDocUnits(e);
    builder.addPoint(x, y);
    scheduleDraw();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!builder || !e.isPrimary) {
      return;
    }
    // One point per event (~60 Hz), no coalesced unpacking: the Lang
    // window is measured in points, so sampling density defines how
    // strongly the line simplifies — the reference samples per event.
    const [x, y] = toDocUnits(e);
    builder.addPoint(x, y);
    scheduleDraw();
  }

  function onPointerUp(e: PointerEvent): void {
    if (!builder || !e.isPrimary) {
      return;
    }
    const stroke = builder.commit();
    builder = null;
    try {
      addStroke(editor.doc, editor.activeFrame, stroke);
      editor.touched = true;
    } catch (err) {
      // Document is at a format limit — drop the stroke instead of crashing the input handler.
      console.warn('stroke rejected:', err);
    }
    scheduleDraw();
  }

  function onPointerCancel(e: PointerEvent): void {
    if (!builder || !e.isPrimary) {
      return;
    }
    builder = null;
    scheduleDraw();
  }
</script>

<div class="wrap" bind:clientWidth={wrapWidth} bind:clientHeight={wrapHeight}>
  <canvas
    bind:this={canvasEl}
    style:width="{cssWidth}px"
    style:height="{cssHeight}px"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerCancel}
  ></canvas>
</div>

<style>
  .wrap {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  canvas {
    display: block;
    background: #fff;
    border: 1px solid #ccc;
    border-radius: 4px;
    /* Page scroll/zoom must not hijack drawing. */
    touch-action: none;
    cursor: crosshair;
  }
</style>
