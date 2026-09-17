<script lang="ts">
  import type { EditorState } from './editor-state.svelte';
  import { BACKGROUND_COLOR, CANVAS_LOGICAL_WIDTH, FIXED_POINT_SCALE, ONION_SKIN_ALPHAS } from '../format/constants';
  import type { Frame, Layer } from '../format/types';
  import { addStroke, frameCount } from '../model/operations';
  import type { Viewport } from '../render/contract';
  import {
    blitLayer,
    renderRawPolyline,
    renderResolvedPreview,
    renderStrokesLayer,
    type BlitTarget,
    type Canvas2DLike,
  } from '../render/canvas2d';
  import { onionLayers, pickSource } from './frame-selection';
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

  let canvasEl: HTMLCanvasElement;
  let wrapWidth = $state(CANVAS_LOGICAL_WIDTH);
  let wrapHeight = $state(0);
  let cursorX = $state(0);
  let cursorY = $state(0);
  let cursorVisible = $state(false);
  /** Transient message over the canvas (e.g. drawing into a hidden layer). */
  const HIDDEN_LAYER_HINT = 'Слой скрыт';
  let hint = $state('');
  let hintTimer = 0;
  const pointer = new PointerStrokeController(() => ({
    profile: editor.drawingProfile,
    descriptor: editor.tool === 'eraser'
      ? { kind: 'eraser', dialect: editor.drawingProfile, width: brushWidthDoc(editor.brushSizeLogical) }
      : { kind: 'pencil', dialect: editor.drawingProfile, width: brushWidthDoc(editor.brushSizeLogical), color: editor.brushColor },
    tonio: { smooth: editor.tonioSmooth, minDistance: editor.tonioMinDistance },
    tonioCoordinateScale: TONIO_CANVAS_WIDTH / (editor.doc.width / FIXED_POINT_SCALE),
    oldschool: editor.oldschool,
  }));
  /**
   * Layer pinned at pointerdown — the object, not its index: a reorder during
   * the gesture would make an index point at a different layer.
   */
  let strokeLayer: Layer | undefined;

  // Three composite buffers instead of a canvas per visited frame: everything
  // under the active layer, the active layer itself, everything above. Memory
  // is bounded by the canvas size, not by how many frames were visited.
  let belowEl: HTMLCanvasElement | null = null;
  let activeEl: HTMLCanvasElement | null = null;
  let aboveEl: HTMLCanvasElement | null = null;
  /**
   * Set by the reactive effect, which already tracks every document
   * dependency the buffers are built from. A digest over stroke counts would
   * miss a paste that swaps cells of the same length, so the subscription —
   * not a hand-rolled key — decides when the stack is stale.
   */
  let stackDirty = true;
  let stackSize = { width: 0, height: 0 };
  /** Scratch for the active layer plus the live stroke (the eraser cuts only here). */
  let liveEl: HTMLCanvasElement | null = null;
  /** Scratch for the whole frame when it is blitted at a profile alpha < 1. */
  let compositeEl: HTMLCanvasElement | null = null;
  /** Scratch one layer is rasterized into before it lands on a stack buffer. */
  let layerScratchEl: HTMLCanvasElement | null = null;
  let rafPending = false;

  // Onion neighbors: at most the onion depth on each side, so a handful of
  // cells. Keyed by (layer, frame, stroke count), oldest evicted first.
  const ONION_CACHE_LIMIT = 4;
  const onionCache = new Map<string, HTMLCanvasElement>();

  /**
   * Stable id per layer or cell object. Cache keys built from indices and
   * stroke counts collide after a reorder, a paste of equal length or a
   * document swap; object identity does not.
   */
  const nodeIds = new WeakMap<object, number>();
  let nextNodeId = 0;
  function nodeId(node: object): number {
    let id = nodeIds.get(node);
    if (id === undefined) {
      id = nextNodeId++;
      nodeIds.set(node, id);
    }
    return id;
  }

  function buffer(el: HTMLCanvasElement | null, pxW: number, pxH: number): HTMLCanvasElement {
    const canvas = el ?? document.createElement('canvas');
    if (canvas.width !== pxW) canvas.width = pxW;
    if (canvas.height !== pxH) canvas.height = pxH;
    return canvas;
  }

  /** Rasterizes `cells` into a transparent buffer, bottom-up. */
  function paintStack(
    el: HTMLCanvasElement,
    cells: Frame[],
    pxW: number,
    pxH: number,
    viewport: Viewport,
  ): void {
    const ctx = el.getContext('2d') as unknown as ViewCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pxW, pxH);
    if (cells.length === 1) {
      // A single layer cannot bleed into another — rasterize it in place.
      renderStrokesLayer(cells[0], editor.doc.tools, ctx, viewport);
      return;
    }
    for (const cell of cells) {
      // Each layer rasterizes into its own scratch first, so an eraser cuts
      // only its own layer — then the scratch lands on the stack buffer.
      layerScratchEl = buffer(layerScratchEl, pxW, pxH);
      const sctx = layerScratchEl.getContext('2d') as unknown as ViewCtx;
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.clearRect(0, 0, pxW, pxH);
      renderStrokesLayer(cell, editor.doc.tools, sctx, viewport);
      blitLayer(layerScratchEl, ctx);
    }
  }

  function rebuildStack(frame: number, pxW: number, pxH: number, viewport: Viewport): void {
    const layers = editor.doc.layers;
    const below: Frame[] = [];
    const above: Frame[] = [];
    for (let l = 0; l < layers.length; l++) {
      const cell = layers[l].frames[frame];
      if (!cell || layers[l].hidden || l === editor.activeLayer) {
        continue;
      }
      (l < editor.activeLayer ? below : above).push(cell);
    }
    belowEl = buffer(belowEl, pxW, pxH);
    aboveEl = buffer(aboveEl, pxW, pxH);
    activeEl = buffer(activeEl, pxW, pxH);
    paintStack(belowEl, below, pxW, pxH, viewport);
    paintStack(aboveEl, above, pxW, pxH, viewport);
    const activeCell = layers[editor.activeLayer]?.frames[frame];
    paintStack(activeEl, activeCell && !layers[editor.activeLayer].hidden ? [activeCell] : [], pxW, pxH, viewport);
  }

  /** Neighbor cell of the active layer, cached (onion shows that layer only). */
  function onionCell(frame: number, pxW: number, pxH: number, viewport: Viewport): HTMLCanvasElement | null {
    const layer = editor.doc.layers[editor.activeLayer];
    const cell = layer?.frames[frame];
    if (!cell || layer.hidden || cell.strokes.length === 0) {
      return null;
    }
    const key = `${nodeId(layer)}:${nodeId(cell)}:${cell.strokes.length}:${pxW}x${pxH}`;
    const cached = onionCache.get(key);
    if (cached) {
      return cached;
    }
    const el = buffer(null, pxW, pxH);
    const ctx = el.getContext('2d') as unknown as ViewCtx;
    ctx.clearRect(0, 0, pxW, pxH);
    renderStrokesLayer(cell, editor.doc.tools, ctx, viewport);
    onionCache.set(key, el);
    while (onionCache.size > ONION_CACHE_LIMIT) {
      onionCache.delete(onionCache.keys().next().value as string);
    }
    return el;
  }

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
    const frame = editor.displayedFrame;
    if (!editor.doc.layers[0]?.frames[frame]) {
      return;
    }

    if (stackDirty || stackSize.width !== pxWidth || stackSize.height !== pxHeight) {
      rebuildStack(frame, pxWidth, pxHeight, viewport);
      stackDirty = false;
      stackSize = { width: pxWidth, height: pxHeight };
    }

    // Background once, then transparent stroke layers on top.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BACKGROUND_COLOR;
    ctx.fillRect(0, 0, pxWidth, pxHeight);

    // Onion-skin under the whole current frame: neighbor cells of the active
    // layer in their real colors, fading with distance (farthest first).
    if (editor.showOnionSkin) {
      for (const neighbor of onionLayers(editor.activeFrame, frameCount(editor.doc), ONION_SKIN_ALPHAS, editor.ux.onionSides)) {
        const el = onionCell(neighbor.index, pxWidth, pxHeight, viewport);
        if (!el) {
          continue;
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = neighbor.alpha;
        ctx.drawImage(el, 0, 0);
      }
      ctx.globalAlpha = 1;
    }

    // The live stroke belongs to the active layer: it composites with that
    // layer alone, so an eraser punches its alpha and not the layers below.
    const session = pointer.session;
    let activeWithLive = activeEl!;
    if (session && strokeLayer === editor.doc.layers[editor.activeLayer]) {
      liveEl = buffer(liveEl, pxWidth, pxHeight);
      const lctx = liveEl.getContext('2d') as unknown as ViewCtx;
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, pxWidth, pxHeight);
      lctx.drawImage(activeEl!, 0, 0);
      const erase = session.descriptor.kind === 'eraser';
      lctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
      renderSessionPreview(session, lctx, viewport, erase ? BACKGROUND_COLOR : session.descriptor.color);
      lctx.globalCompositeOperation = 'source-over';
      activeWithLive = liveEl;
    }

    // The profile's active alpha (Multator: 0.8, its containerSprite) applies
    // to the whole current frame, so the stack composites offscreen first.
    const alpha = editor.playing ? 1 : editor.ux.activeFrameAlpha;
    if (alpha < 1) {
      compositeEl = buffer(compositeEl, pxWidth, pxHeight);
      const cctx = compositeEl.getContext('2d') as unknown as ViewCtx;
      cctx.setTransform(1, 0, 0, 1, 0, 0);
      cctx.clearRect(0, 0, pxWidth, pxHeight);
      cctx.drawImage(belowEl!, 0, 0);
      cctx.drawImage(activeWithLive, 0, 0);
      cctx.drawImage(aboveEl!, 0, 0);
      ctx.globalAlpha = alpha;
      blitLayer(compositeEl, ctx);
      ctx.globalAlpha = 1;
    } else {
      blitLayer(belowEl!, ctx);
      blitLayer(activeWithLive, ctx);
      blitLayer(aboveEl!, ctx);
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

  function showHint(message: string): void {
    hint = message;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (hint = ''), 1600) as unknown as number;
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
    // Every document dependency the three buffers are built from: the frame,
    // the active layer, and each layer's identity, visibility and cell. Read
    // here so the subscription — not a digest — is what invalidates them.
    void cssWidth;
    void editor.displayedFrame;
    void editor.activeLayer;
    void editor.showOnionSkin;
    void editor.ux;
    const frame = editor.displayedFrame;
    for (const layer of editor.doc.layers) {
      void layer.hidden;
      const cell = layer.frames[frame];
      void cell;
      void cell?.strokes.length;
    }
    const active = editor.activeFrame;
    const activeLayer = editor.doc.layers[editor.activeLayer];
    for (let distance = 1; distance <= ONION_SKIN_ALPHAS.length; distance++) {
      void activeLayer?.frames[active - distance]?.strokes.length;
      void activeLayer?.frames[active + distance]?.strokes.length;
    }
    stackDirty = true;
    scheduleDraw();
  });

  function toDocUnits(e: { clientX: number; clientY: number }): [number, number] {
    const rect = canvasEl.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * editor.doc.width;
    const y = ((e.clientY - rect.top) / rect.height) * editor.doc.height;
    return [x, y];
  }

  /**
   * Color under the pointer. "Canvas" reads the visible composite of the
   * current frame (no onion, no live stroke); "Layer" reads the active layer
   * alone. Alt takes the layer for this click without changing the setting.
   * A transparent pixel is the background.
   */
  function pickColor(e: PointerEvent): string {
    const source = pickSource(editor.pickSource, e.altKey);
    const rect = canvasEl.getBoundingClientRect();
    const px = Math.min(canvasEl.width - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * canvasEl.width)));
    const py = Math.min(canvasEl.height - 1, Math.max(0, Math.floor(((e.clientY - rect.top) / rect.height) * canvasEl.height)));
    let el = activeEl;
    if (source === 'canvas') {
      compositeEl = buffer(compositeEl, canvasEl.width, canvasEl.height);
      const cctx = compositeEl.getContext('2d') as unknown as ViewCtx;
      cctx.setTransform(1, 0, 0, 1, 0, 0);
      cctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      cctx.drawImage(belowEl!, 0, 0);
      cctx.drawImage(activeEl!, 0, 0);
      cctx.drawImage(aboveEl!, 0, 0);
      el = compositeEl;
    }
    if (!el) {
      return BACKGROUND_COLOR;
    }
    const [r, g, b, a] = el.getContext('2d')!.getImageData(px, py, 1, 1).data;
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
    if (editor.activeLayerHidden) {
      // Nothing would appear — say so instead of swallowing the gesture.
      showHint(HIDDEN_LAYER_HINT);
      return;
    }
    strokeLayer = editor.doc.layers[editor.activeLayer];
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
    // The pinned layer may have been removed mid-gesture; then it has no index
    // any more and the stroke has nowhere to land.
    const index = strokeLayer ? editor.doc.layers.indexOf(strokeLayer) : -1;
    if (index < 0) return;
    try {
      addStroke(editor.doc, index, editor.activeFrame, stroke);
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
  {#if hint}
    <p class="hint" role="status" aria-live="polite">{hint}</p>
  {/if}
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
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  canvas {
    display: block;
    background: var(--canvas, #fff);
    /* A defined frame on the paper worktable: hairline edge + soft plate shadow. */
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
  .hint {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    padding: 6px 12px;
    border-radius: 999px;
    background: var(--ink, #0b0c10);
    color: var(--canvas, #fff);
    font-size: 13px;
    pointer-events: none;
  }
</style>
