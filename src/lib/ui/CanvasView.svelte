<script lang="ts">
  import type { EditorState } from './editor-state.svelte';
  import { BACKGROUND_COLOR, CANVAS_LOGICAL_WIDTH, FIXED_POINT_SCALE, ONION_SKIN_ALPHAS } from '../format/constants';
  import type { Frame } from '../format/types';
  import { addStroke } from '../model/operations';
  import type { Viewport } from '../render/contract';
  import {
    blitLayer,
    renderRawPolyline,
    renderResolvedPreview,
    renderStrokesLayer,
    type BlitTarget,
    type Canvas2DLike,
  } from '../render/canvas2d';
  import { onionLayers } from './frame-selection';
  import { brushWidthDoc } from '../tools/stroke-builder';
  import {
    PointerStrokeController,
    TONIO_CANVAS_WIDTH,
    previewStrokeSession,
    type PointerSample,
  } from '../tools/profiles';

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
  let cursorX = $state(0);
  let cursorY = $state(0);
  let cursorVisible = $state(false);
  const pointer = new PointerStrokeController(() => ({
    profile: editor.drawingProfile,
    descriptor: editor.tool === 'eraser'
      ? { kind: 'eraser', dialect: editor.drawingProfile, width: brushWidthDoc(editor.brushSizeLogical) }
      : { kind: 'pencil', dialect: editor.drawingProfile, width: brushWidthDoc(editor.brushSizeLogical), color: editor.brushColor },
    tonio: { smooth: editor.tonioSmooth, minDistance: editor.tonioMinDistance },
    tonioCoordinateScale: TONIO_CANVAS_WIDTH / (editor.doc.width / FIXED_POINT_SCALE),
  }));
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
  const cursorDiameter = $derived(Math.max(1, editor.brushSizeLogical * cssWidth / CANVAS_LOGICAL_WIDTH));
  // Reference cursor: a ring in the pen color with a white outline. White
  // itself would vanish on the white canvas, so it falls back to ink.
  const cursorColor = $derived(
    editor.tool === 'pencil' && editor.brushColor.toLowerCase() !== BACKGROUND_COLOR
      ? editor.brushColor
      : 'var(--ink)',
  );

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
      renderStrokesLayer(frame, editor.doc.tools, lctx, viewport);
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
      for (const layer of onionLayers(editor.activeFrame, frames.length, ONION_SKIN_ALPHAS, editor.ux.onionSides)) {
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

    // Active frame over onion, then the live stroke. The profile's active
    // alpha (Multator: 0.8, its containerSprite) applies to layer + live
    // stroke together, so they composite offscreen first — the same scratch
    // path the eraser needs to punch only the active frame's layer.
    const layer = frameLayer(frame, pxWidth, pxHeight, viewport);
    const session = pointer.session;
    const alpha = editor.playing ? 1 : editor.ux.activeFrameAlpha;
    if (session || alpha < 1) {
      scratchEl ??= document.createElement('canvas');
      if (scratchEl.width !== pxWidth || scratchEl.height !== pxHeight) {
        scratchEl.width = pxWidth;
        scratchEl.height = pxHeight;
      }
      const sctx = scratchEl.getContext('2d') as unknown as ViewCtx;
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.clearRect(0, 0, pxWidth, pxHeight);
      sctx.drawImage(layer, 0, 0);
      if (session) {
        const erase = session.descriptor.kind === 'eraser';
        sctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
        renderSessionPreview(session, sctx, viewport, erase ? BACKGROUND_COLOR : session.descriptor.color);
        sctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = alpha;
      blitLayer(scratchEl, ctx);
      ctx.globalAlpha = 1;
    } else {
      blitLayer(layer, ctx);
    }
  }

  function renderSessionPreview(
    session: NonNullable<typeof pointer.session>,
    target: Canvas2DLike,
    viewport: Viewport,
    color: string,
  ): void {
    if (session.profile === 'multator') {
      renderRawPolyline(session.rawPoints, session.descriptor.width, color, target, viewport);
    } else {
      renderResolvedPreview(previewStrokeSession(session), session.descriptor, color, target, viewport);
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
    void editor.ux;
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
    if (editor.playing || !e.isPrimary || pointer.session) {
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
    pointer.pointerDown(toPointerSample(e, true));
    scheduleDraw();
  }

  function onPointerMove(e: PointerEvent): void {
    cursorX = e.clientX;
    cursorY = e.clientY;
    if (!pointer.session || !e.isPrimary) {
      return;
    }
    // Multator keeps one point per event; Tonio unpacks its coalesced batch.
    pointer.pointerMove(toPointerSample(e, true));
    scheduleDraw();
  }

  function onPointerUp(e: PointerEvent): void {
    if (!pointer.session || !e.isPrimary) {
      return;
    }
    pointer.pointerUp(toPointerSample(e, true));
    commitPendingStroke();
    scheduleDraw();
  }

  function commitPendingStroke(): void {
    const stroke = pointer.takeCommitted();
    if (!stroke) return;
    try {
      addStroke(editor.doc, editor.activeFrame, stroke);
      editor.touched = true;
    } catch (err) {
      // Document is at a format limit — drop the stroke instead of crashing the input handler.
      console.warn('stroke rejected:', err);
    }
  }

  function onPointerCancel(e: PointerEvent): void {
    if (!pointer.session || !e.isPrimary) {
      return;
    }
    pointer.pointerCancel(toPointerSample(e));
    commitPendingStroke();
    scheduleDraw();
  }

  function toPointerSample(e: PointerEvent, unpackCoalesced = false): PointerSample {
    const [x, y] = toDocUnits(e);
    const coalesced = unpackCoalesced && (pointer.session?.profile ?? editor.drawingProfile) === 'toonio'
      ? e.getCoalescedEvents?.().map((sample) => {
          const [sampleX, sampleY] = toDocUnits(sample);
          return { pointerId: sample.pointerId, isPrimary: sample.isPrimary, x: sampleX, y: sampleY };
        })
      : undefined;
    return { pointerId: e.pointerId, isPrimary: e.isPrimary, x, y, coalesced };
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
    onpointerenter={(event) => {
      cursorVisible = true;
      cursorX = event.clientX;
      cursorY = event.clientY;
    }}
    onpointerleave={() => (cursorVisible = false)}
    class:custom-cursor={editor.tool !== 'pipette'}
  ></canvas>
  {#if cursorVisible && editor.tool !== 'pipette'}
    <span
      class="brush-cursor"
      class:eraser={editor.tool === 'eraser'}
      style:left="{cursorX}px"
      style:top="{cursorY}px"
      style:width="{cursorDiameter}px"
      style:height="{cursorDiameter}px"
      style:border-color={cursorColor}
      aria-hidden="true"
    ></span>
  {/if}
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
  canvas.custom-cursor {
    cursor: none;
  }
  .brush-cursor {
    position: fixed;
    z-index: 30;
    transform: translate(-50%, -50%);
    border: 1px solid var(--ink);
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--canvas);
    pointer-events: none;
  }
  .brush-cursor.eraser {
    border-style: dashed;
  }
</style>
