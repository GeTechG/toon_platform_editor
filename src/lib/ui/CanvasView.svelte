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
  // Scratch canvas for the live eraser preview: the erase must punch only
  // the active frame's layer, so layer + live stroke composite offscreen.
  let scratchEl: HTMLCanvasElement | null = null;
  let rafPending = false;
  // One transparent, real-color strokes layer per frame (keyed by frame
  // identity), re-rendered only when its stroke count or the pixel size
  // changes. The active frame and every onion neighbor composite from these —
  // onion is the same drawing, just blitted at a lower globalAlpha.
  const frameLayers = new WeakMap<Frame, LayerCache>();

  // Fit inside the wrap (whose size is set by the page layout, not by the
  // canvas itself): capped by width and, when known, by height.
  const cssWidth = $derived(
    Math.max(
      1,
      Math.min(
        wrapWidth || CANVAS_LOGICAL_WIDTH,
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
    const layer = frameLayer(frame, pxWidth, pxHeight, viewport);
    if (builder && builder.brush.erase) {
      scratchEl ??= document.createElement('canvas');
      if (scratchEl.width !== pxWidth || scratchEl.height !== pxHeight) {
        scratchEl.width = pxWidth;
        scratchEl.height = pxHeight;
      }
      const sctx = scratchEl.getContext('2d') as unknown as ViewCtx;
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.clearRect(0, 0, pxWidth, pxHeight);
      sctx.drawImage(layer, 0, 0);
      sctx.globalCompositeOperation = 'destination-out';
      renderRawPolyline(builder.rawPoints, builder.brush.width, builder.brush.color, sctx, viewport);
      sctx.globalCompositeOperation = 'source-over';
      blitLayer(scratchEl, ctx);
    } else {
      blitLayer(layer, ctx);
      if (builder) {
        renderRawPolyline(builder.rawPoints, builder.brush.width, builder.brush.color, ctx, viewport);
      }
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

  /** Color of the active frame at the pointer, from its strokes-only layer (onion/live stroke excluded). */
  function pickColor(e: PointerEvent): string {
    const frame = editor.doc.frames[editor.activeFrame];
    const rect = canvasEl.getBoundingClientRect();
    const px = Math.min(canvasEl.width - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * canvasEl.width)));
    const py = Math.min(canvasEl.height - 1, Math.max(0, Math.floor(((e.clientY - rect.top) / rect.height) * canvasEl.height)));
    const viewport = { scale: cssWidth / editor.doc.width, dpr: window.devicePixelRatio || 1 };
    const layer = frameLayer(frame, canvasEl.width, canvasEl.height, viewport);
    const [r, g, b, a] = layer.getContext('2d')!.getImageData(px, py, 1, 1).data;
    if (a === 0) {
      return BACKGROUND_COLOR;
    }
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  function onPointerDown(e: PointerEvent): void {
    if (editor.playing || !e.isPrimary || builder) {
      return;
    }
    if (editor.tool === 'pipette') {
      const picked = pickColor(e);
      editor.brushColor = picked;
      // Picking emptiness/background arms the eraser, a color arms the pencil.
      editor.tool = picked === BACKGROUND_COLOR ? 'eraser' : 'pencil';
      return;
    }
    canvasEl.setPointerCapture(e.pointerId);
    builder = new StrokeBuilder({
      width: brushWidthDoc(editor.brushSizeLogical),
      color: editor.brushColor,
      erase: editor.tool === 'eraser',
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
  /* Canvas letterboxed in the middle of the stage. */
  .wrap {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  canvas {
    display: block;
    background: var(--canvas, #fff);
    /* Defined "кадр" on the paper worktable: hairline edge + soft plate shadow. */
    border: 1px solid var(--hairline, #0b0c1024);
    box-shadow: 0 10px 30px -14px rgba(15, 23, 60, 0.35);
    /* Page scroll/zoom must not hijack drawing. */
    touch-action: none;
    cursor: crosshair;
  }
</style>
