<script lang="ts">
  import type { EditorState } from './editor-state.svelte';
  import { BACKGROUND_COLOR, CANVAS_LOGICAL_WIDTH, FIXED_POINT_SCALE } from '../format/constants';
  import type { Frame, Layer } from '../format/types';
  import { frameCount } from '../model/operations';
  import type { Viewport } from '../render/contract';
  import {
    blitLayer,
    renderRawPolyline,
    renderResolvedPreview,
    renderStrokesLayer,
    type BlitTarget,
    type Canvas2DLike,
  } from '../render/canvas2d';
  import { pickSource } from './frame-selection';
  import { boxCorners, cornerAt, movedCorner } from '../tools/lasso';
  import { ZOOM_STEP, clampPan, toDocument, zoomAt } from './viewport';
  import { brushWidthDoc } from '../tools/stroke-builder';
  import type { LineToolDescriptor } from '../format/types';
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
  /** Color the pipette would take, shown next to the cursor (Tonio). */
  let pickPreview = $state<string | null>(null);
  /** Pointer that is panning the canvas (middle button or space+drag). */
  let panning: { pointerId: number; x: number; y: number } | null = null;
  let spaceHeld = false;
  /** Active touch points, for two-finger pan and pinch. */
  const touches = new Map<number, { x: number; y: number }>();
  let gesture: { distance: number; midX: number; midY: number; zoom: number } | null = null;
  /** Live mega-eraser gesture in document units, or null when idle. */
  let megaGesture = $state<number[] | null>(null);
  /** Pointer owning the mega-eraser or lasso gesture — only one runs at a time. */
  let gesturePointerId = -1;
  /** Lasso polygon being traced, in document units; null when idle. */
  let lassoPolygon = $state<number[] | null>(null);
  /**
   * Drag inside an open transform: which corner is held (null = the body, so
   * the drag moves the selection) and where it started, in document units.
   */
  let grab: { pointerId: number; corner: number | null; x: number; y: number } | null = null;
  let lastPickPreview = 0;
  const PIPETTE_THROTTLE_MS = 100;
  /** Transient message over the canvas (e.g. drawing into a hidden layer). */
  const HIDDEN_LAYER_HINT = 'Слой скрыт';
  let hint = $state('');
  let hintTimer = 0;
  /** Descriptor for the active tool, frozen into the session at pointerdown. */
  function activeDescriptor(): LineToolDescriptor {
    const width = brushWidthDoc(editor.brushSizeLogical);
    switch (editor.tool) {
      case 'eraser':
        return { kind: 'eraser', dialect: editor.drawingProfile, width };
      case 'feather':
        return { kind: 'feather', dialect: 'toonio', width, color: editor.brushColor, fill: editor.fillColor };
      case 'pixel':
        return { kind: 'pixel', dialect: 'toonio', width, color: editor.brushColor };
      default:
        return { kind: 'pencil', dialect: editor.drawingProfile, width, color: editor.brushColor };
    }
  }

  const pointer = new PointerStrokeController(() => ({
    profile: editor.drawingProfile,
    descriptor: activeDescriptor(),
    tonio: { smooth: editor.tonioSmooth, minDistance: editor.tonioMinDistance },
    tonioCoordinateScale: TONIO_CANVAS_WIDTH / (editor.doc.width / FIXED_POINT_SCALE),
    oldschool: editor.oldschool,
    zoom: editor.view.zoom,
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
    let activeCell = layers[editor.activeLayer]?.frames[frame];
    // While a transform is open its strokes are drawn moved, on top — so they
    // must not also sit here in their old place, or every drag smears.
    const open = editor.transform;
    if (activeCell && open) {
      const held = new Set(open.indices);
      activeCell = { strokes: activeCell.strokes.filter((_, i) => !held.has(i)) };
    }
    paintStack(activeEl, activeCell && !layers[editor.activeLayer].hidden ? [activeCell] : [], pxW, pxH, viewport);
  }

  /** Neighbor cell of the active layer, cached (onion shows that layer only). */
  function onionCell(frame: number, pxW: number, pxH: number, viewport: Viewport): HTMLCanvasElement | null {
    const layer = editor.doc.layers[editor.activeLayer];
    const cell = layer?.frames[frame];
    if (!cell || layer.hidden || cell.strokes.length === 0) {
      return null;
    }
    const key = `${nodeId(layer)}:${nodeId(cell)}:${cell.strokes.length}:${pxW}x${pxH}`
      + `@${viewport.scale}:${viewport.panX}:${viewport.panY}`;
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
  // The canvas is the product. Without a role and a name it lands in the
  // accessibility tree as an anonymous box, so it says what it is and which
  // frame is on it.
  const canvasLabel = $derived(
    `Холст: кадр ${editor.displayedFrame + 1} из ${frameCount(editor.doc)}` +
      (editor.doc.layers.length > 1 ? `, слой ${editor.activeLayer + 1}` : ''),
  );
  /** Grab radius for the handles, in document units — 12 CSS px at this zoom. */
  const handleRadius = $derived(
    (12 * editor.doc.width) / Math.max(1, cssWidth * editor.view.zoom),
  );
  const cursorDiameter = $derived(
    Math.max(1, (editor.brushSizeLogical * cssWidth * editor.view.zoom) / CANVAS_LOGICAL_WIDTH),
  );
  // Reference cursor: a ring in the pen color with a white outline. White
  // itself would vanish on the white canvas, so it falls back to ink.
  const cursorColor = $derived(
    editor.tool === 'pencil' && editor.brushColor.toLowerCase() !== BACKGROUND_COLOR
      ? editor.brushColor
      : 'var(--ink)',
  );

  // The zoom buttons clamp against the canvas size, which only the view knows.
  $effect(() => {
    editor.viewSize = { width: cssWidth, height: cssHeight };
  });

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
    const viewport = {
      scale: (cssWidth / editor.doc.width) * editor.view.zoom,
      dpr,
      panX: editor.view.panX,
      panY: editor.view.panY,
    };
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

    // Onion-skin under the whole current frame: cells of the active layer in
    // their real colors — fading neighbors, or Tonio's last visited frames.
    if (editor.showOnionSkin) {
      for (const neighbor of editor.onionSkinLayers) {
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

    // The mega eraser previews its cut the way the reference does — the
    // gesture punches alpha on top of the layer — while the strokes are only
    // rewritten on pointerup.
    if (megaGesture && megaGesture.length >= 2) {
      liveEl = buffer(liveEl, pxWidth, pxHeight);
      const lctx = liveEl.getContext('2d') as unknown as ViewCtx;
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, pxWidth, pxHeight);
      lctx.drawImage(activeEl!, 0, 0);
      lctx.globalCompositeOperation = 'destination-out';
      renderRawPolyline(
        megaGesture,
        brushWidthDoc(editor.brushSizeLogical),
        BACKGROUND_COLOR,
        lctx,
        viewport,
      );
      lctx.globalCompositeOperation = 'source-over';
      activeWithLive = liveEl;
    }

    // The selection as it stands right now, over the layer it was cut out of.
    const transformed = transformPreviewCell();
    if (transformed) {
      liveEl = buffer(liveEl, pxWidth, pxHeight);
      const lctx = liveEl.getContext('2d') as unknown as ViewCtx;
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, pxWidth, pxHeight);
      lctx.drawImage(activeEl!, 0, 0);
      renderStrokesLayer(transformed, editor.doc.tools, lctx, viewport);
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

  /** The selected strokes at their current transform; null when none is open. */
  function transformPreviewCell(): Frame | null {
    const open = editor.transform;
    const cell = editor.activeCell;
    if (!open || !cell) {
      return null;
    }
    return {
      strokes: open.indices.flatMap((index) => {
        const stroke = cell.strokes[index];
        if (!stroke) {
          return [];
        }
        const points = stroke.points.slice();
        for (let i = 0; i < points.length; i += 2) {
          const [x, y] = editor.transformPoint(points[i], points[i + 1]);
          points[i] = x;
          points[i + 1] = y;
        }
        return [{ points, tool_id: stroke.tool_id }];
      }),
    };
  }

  /** The four handles where they are drawn now — box corners run through the session. */
  const displayedQuad = $derived.by(() => {
    const open = editor.transform;
    if (!open) {
      return null;
    }
    const source = boxCorners(open.box);
    const out: number[] = [];
    for (let i = 0; i < source.length; i += 2) {
      out.push(...editor.transformPoint(source[i], source[i + 1]));
    }
    return out;
  });

  /** Document units → CSS pixels inside the canvas element (the overlay's frame). */
  function toScreen(x: number, y: number): [number, number] {
    return [
      editor.view.panX + (x / editor.doc.width) * cssWidth * editor.view.zoom,
      editor.view.panY + (y / editor.doc.height) * cssHeight * editor.view.zoom,
    ];
  }

  /** Flat document polygon → an SVG `points` string in CSS pixels. */
  function screenPoints(polygon: readonly number[]): string {
    const out: string[] = [];
    for (let i = 0; i < polygon.length; i += 2) {
      out.push(toScreen(polygon[i], polygon[i + 1]).join(','));
    }
    return out.join(' ');
  }

  /**
   * Scale that puts `corner` under the pointer. The pointer is un-rotated and
   * un-translated first, so dragging a handle on a turned selection still
   * scales along the selection's own axes.
   */
  function scaleFromCorner(
    open: NonNullable<typeof editor.transform>,
    corner: number,
    x: number,
    y: number,
  ) {
    const cx = open.box.x + open.box.width / 2;
    const cy = open.box.y + open.box.height / 2;
    const angle = (-open.session.rotate * Math.PI) / 180;
    const dx = x - open.session.dx - cx;
    const dy = y - open.session.dy - cy;
    const ux = dx * Math.cos(angle) - dy * Math.sin(angle);
    const uy = dx * Math.sin(angle) + dy * Math.cos(angle);
    const source = boxCorners(open.box);
    const rx = source[corner * 2] - cx;
    const ry = source[corner * 2 + 1] - cy;
    // A selection with no extent on an axis cannot be scaled along it.
    return {
      ...open.session,
      scaleX: Math.abs(rx) < 1 ? open.session.scaleX : ux / rx,
      scaleY: Math.abs(ry) < 1 ? open.session.scaleY : uy / ry,
    };
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
    void editor.view;
    void editor.transform;
    const frame = editor.displayedFrame;
    for (const layer of editor.doc.layers) {
      void layer.hidden;
      const cell = layer.frames[frame];
      void cell;
      void cell?.strokes.length;
    }
    const activeLayer = editor.doc.layers[editor.activeLayer];
    for (const onion of editor.onionSkinLayers) {
      void activeLayer?.frames[onion.index]?.strokes.length;
    }
    stackDirty = true;
    scheduleDraw();
  });

  function toDocUnits(e: { clientX: number; clientY: number }): [number, number] {
    const rect = canvasEl.getBoundingClientRect();
    return toDocument(e.clientX - rect.left, e.clientY - rect.top, rect, editor.doc, editor.view);
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

  /**
   * Navigation gestures, before drawing gets a say: middle button or a held
   * space pans, two fingers pan and pinch. A second finger never interrupts a
   * stroke already under way — it is ignored until the first one lifts.
   */
  function startNavigation(e: PointerEvent): boolean {
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2 && !pointer.session) {
        gesture = pinchFrom(touches);
        return true;
      }
      return touches.size > 1;
    }
    // The hand is the tool whose whole job is this gesture (reference `Drag`).
    if (e.button === 1 || spaceHeld || editor.tool === 'drag') {
      panning = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
      canvasEl.setPointerCapture(e.pointerId);
      return true;
    }
    return false;
  }

  function pinchFrom(points: Map<number, { x: number; y: number }>) {
    const [a, b] = [...points.values()];
    return {
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
      zoom: editor.view.zoom,
    };
  }

  function panBy(dx: number, dy: number): void {
    const rect = canvasEl.getBoundingClientRect();
    editor.view = clampPan(
      { zoom: editor.view.zoom, panX: editor.view.panX + dx, panY: editor.view.panY + dy },
      rect.width,
      rect.height,
    );
  }

  function zoomTo(zoom: number, clientX: number, clientY: number): void {
    const rect = canvasEl.getBoundingClientRect();
    editor.view = zoomAt(editor.view, zoom, clientX - rect.left, clientY - rect.top, rect.width, rect.height);
  }

  /** Wheel zooms in the reference's 0.5 steps; Ctrl+wheel stays the browser's. */
  function onWheel(e: WheelEvent): void {
    if (e.ctrlKey || e.metaKey) {
      return;
    }
    e.preventDefault();
    zoomTo(editor.view.zoom + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP), e.clientX, e.clientY);
  }

  function onPointerDown(e: PointerEvent): void {
    if (startNavigation(e)) {
      e.preventDefault();
      return;
    }
    if (editor.playing || !e.isPrimary || pointer.session) {
      return;
    }
    // A live transform owns the canvas: a handle scales or distorts, anywhere
    // else moves. It comes before every drawing tool.
    if (editor.transform) {
      const [x, y] = toDocUnits(e);
      grab = {
        pointerId: e.pointerId,
        corner: cornerAt(displayedQuad ?? [], x, y, handleRadius),
        x,
        y,
      };
      canvasEl.setPointerCapture(e.pointerId);
      return;
    }
    // Lasso and distort both start by tracing the selection polygon.
    if (editor.tool === 'lasso' || editor.tool === 'distort') {
      if (editor.activeLayerHidden) {
        showHint(HIDDEN_LAYER_HINT);
        return;
      }
      const [x, y] = toDocUnits(e);
      lassoPolygon = [x, y];
      canvasEl.setPointerCapture(e.pointerId);
      gesturePointerId = e.pointerId;
      scheduleDraw();
      return;
    }
    if (editor.tool === 'pipette') {
      const picked = pickColor(e);
      // Picking emptiness/background arms the eraser (reference: alpha ≠ 255 → eraser).
      if (picked === BACKGROUND_COLOR) {
        editor.brushColor = picked;
        editor.tool = 'eraser';
        return;
      }
      // Right button takes the fill color (reference: ЛКМ — контур, ПКМ — заливка).
      const toFill = e.button === 2 && editor.ux.tools.includes('feather');
      editor.pickColor(picked, toFill ? 'fill' : 'outline');
      if (!toFill) {
        editor.tool = 'pencil';
      }
      return;
    }
    if (editor.tool === 'mega-eraser') {
      if (editor.activeLayerHidden) {
        showHint(HIDDEN_LAYER_HINT);
        return;
      }
      const [x, y] = toDocUnits(e);
      megaGesture = [Math.round(x), Math.round(y)];
      canvasEl.setPointerCapture(e.pointerId);
      gesturePointerId = e.pointerId;
      scheduleDraw();
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
    if (panning && e.pointerId === panning.pointerId) {
      panBy(e.clientX - panning.x, e.clientY - panning.y);
      panning = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    if (megaGesture && e.pointerId === gesturePointerId) {
      const [x, y] = toDocUnits(e);
      megaGesture.push(Math.round(x), Math.round(y));
      scheduleDraw();
      return;
    }
    if (lassoPolygon && e.pointerId === gesturePointerId) {
      const [x, y] = toDocUnits(e);
      lassoPolygon.push(x, y);
      scheduleDraw();
      return;
    }
    if (grab && e.pointerId === grab.pointerId) {
      dragTransform(e);
      return;
    }
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gesture && touches.size === 2) {
        const next = pinchFrom(touches);
        zoomTo(gesture.zoom * (next.distance / gesture.distance), next.midX, next.midY);
        panBy(next.midX - gesture.midX, next.midY - gesture.midY);
        gesture = { ...next, zoom: gesture.zoom * (next.distance / gesture.distance) };
        return;
      }
      if (touches.size > 1) {
        return;
      }
    }
    // Tonio's pipette previews the color it would take, throttled to 100 ms
    // (tools.js Picker.MouseMove) — that cap is also what keeps a cheap phone
    // from reading a pixel back on every move event.
    if (editor.tool === 'pipette' && editor.ux.livePipettePreview) {
      const now = performance.now();
      if (now - lastPickPreview >= PIPETTE_THROTTLE_MS) {
        lastPickPreview = now;
        pickPreview = pickColor(e);
      }
    }
    if (!pointer.session || !e.isPrimary) {
      return;
    }
    // Multator keeps one point per event; Tonio unpacks its coalesced batch.
    pointer.pointerMove(toPointerSample(e, true));
    scheduleDraw();
  }

  function endNavigation(e: PointerEvent): boolean {
    touches.delete(e.pointerId);
    if (touches.size < 2) {
      gesture = null;
    }
    if (panning && e.pointerId === panning.pointerId) {
      panning = null;
      return true;
    }
    return false;
  }

  function onPointerUp(e: PointerEvent): void {
    if (endNavigation(e)) {
      return;
    }
    if (grab && e.pointerId === grab.pointerId) {
      grab = null;
      return;
    }
    if (lassoPolygon && e.pointerId === gesturePointerId) {
      editor.beginTransform(lassoPolygon);
      lassoPolygon = null;
      gesturePointerId = -1;
      scheduleDraw();
      return;
    }
    if (megaGesture && e.pointerId === gesturePointerId) {
      editor.applyMegaEraser(megaGesture, brushWidthDoc(editor.brushSizeLogical) / 2);
      megaGesture = null;
      gesturePointerId = -1;
      stackDirty = true;
      scheduleDraw();
      return;
    }
    if (!pointer.session || !e.isPrimary) {
      return;
    }
    pointer.pointerUp(toPointerSample(e, true));
    commitPendingStroke();
    scheduleDraw();
  }

  /** One pointermove inside a live transform: handle scales/distorts, body moves. */
  function dragTransform(e: PointerEvent): void {
    const open = editor.transform;
    if (!open || !grab) {
      return;
    }
    const [x, y] = toDocUnits(e);
    if (grab.corner !== null && editor.tool === 'distort') {
      editor.setTransformQuad(movedCorner(editor.transformQuad, grab.corner, x, y));
    } else if (grab.corner !== null) {
      editor.setTransform(scaleFromCorner(open, grab.corner, x, y));
    } else if (open.quad) {
      // A distorted selection has no affine session left to move — the four
      // corners travel together instead.
      const moved = open.quad.slice();
      for (let i = 0; i < moved.length; i += 2) {
        moved[i] += x - grab.x;
        moved[i + 1] += y - grab.y;
      }
      editor.setTransformQuad(moved);
    } else {
      editor.setTransform({
        ...open.session,
        dx: open.session.dx + (x - grab.x),
        dy: open.session.dy + (y - grab.y),
      });
    }
    grab = { ...grab, x, y };
  }

  function commitPendingStroke(): void {
    const stroke = pointer.takeCommitted();
    if (!stroke) return;
    // The pinned layer may have been removed mid-gesture; then it has no index
    // any more and the stroke has nowhere to land.
    const index = strokeLayer ? editor.doc.layers.indexOf(strokeLayer) : -1;
    if (index < 0) return;
    try {
      editor.commitStroke(index, stroke);
    } catch (err) {
      // Document is at a format limit — drop the stroke instead of crashing the input handler.
      console.warn('stroke rejected:', err);
    }
  }

  function onPointerCancel(e: PointerEvent): void {
    if (endNavigation(e)) {
      return;
    }
    // A cancelled pointer must not leave a half-drawn polygon or a held
    // handle behind: both would keep reacting to the next move.
    if (grab && e.pointerId === grab.pointerId) {
      grab = null;
      return;
    }
    if (e.pointerId === gesturePointerId) {
      megaGesture = null;
      lassoPolygon = null;
      gesturePointerId = -1;
      scheduleDraw();
      return;
    }
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

<svelte:window
  onkeydown={(e) => {
    if (e.key === ' ') {
      spaceHeld = true;
    }
  }}
  onkeyup={(e) => {
    if (e.key === ' ') {
      spaceHeld = false;
    }
  }}
/>

<div class="wrap" bind:clientWidth={wrapWidth} bind:clientHeight={wrapHeight}>
  <!-- ARIA in HTML allows any role on <canvas>; `img` is the honest one for a
       surface that renders a picture, and without it the drawing is an
       anonymous box in the accessibility tree. -->
  <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
  <canvas
    bind:this={canvasEl}
    role="img"
    aria-label={canvasLabel}
    style:width="{cssWidth}px"
    style:height="{cssHeight}px"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onwheel={onWheel}
    oncontextmenu={(e) => {
      // Right-click is the fill-color pipette, not a browser menu.
      if (editor.tool === 'pipette') {
        e.preventDefault();
      }
    }}
    onpointerup={onPointerUp}
    onpointercancel={onPointerCancel}
    onpointerenter={(event) => {
      cursorVisible = true;
      cursorX = event.clientX;
      cursorY = event.clientY;
    }}
    onpointerleave={() => {
      cursorVisible = false;
      pickPreview = null;
    }}
    class:custom-cursor={editor.tool !== 'pipette'}
  ></canvas>
  <!-- Selection chrome. Purely visual: every gesture is read off the canvas
       itself, so pointer capture, touch and the keyboard path stay intact. -->
  {#if lassoPolygon || displayedQuad}
    <svg
      class="overlay"
      width={cssWidth}
      height={cssHeight}
      viewBox="0 0 {cssWidth} {cssHeight}"
      aria-hidden="true"
    >
      {#if lassoPolygon}
        <polygon class="lasso" points={screenPoints(lassoPolygon)} />
      {/if}
      {#if displayedQuad}
        <polygon class="frame" points={screenPoints(displayedQuad)} />
        {#each [0, 1, 2, 3] as corner (corner)}
          {@const [hx, hy] = toScreen(displayedQuad[corner * 2], displayedQuad[corner * 2 + 1])}
          <rect class="handle" x={hx - 5} y={hy - 5} width="10" height="10" />
        {/each}
      {/if}
    </svg>
  {/if}
  {#if hint}
    <p class="hint" role="status" aria-live="polite">{hint}</p>
  {/if}
  {#if cursorVisible && editor.tool === 'pipette' && pickPreview}
    <span
      class="pick-preview"
      style:left="{cursorX}px"
      style:top="{cursorY}px"
      style:background={pickPreview}
      aria-hidden="true"
    ></span>
  {/if}
  {#if cursorVisible && editor.tool !== 'pipette'}
    <span
      class="brush-cursor"
      class:eraser={editor.tool === 'eraser'}
      class:cross={editor.ux.crossCursor
        && (editor.brushSizeLogical <= 3 || editor.brushSizeLogical >= 25)}
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
  .overlay {
    position: absolute;
    /* The canvas is centred in the wrap; the overlay sits exactly on it. */
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .overlay .lasso {
    fill: color-mix(in srgb, var(--electric, #2f6fed) 12%, transparent);
    stroke: var(--electric, #2f6fed);
    stroke-width: 1;
    stroke-dasharray: 4 3;
  }
  .overlay .frame {
    fill: none;
    stroke: var(--electric, #2f6fed);
    stroke-width: 1;
    stroke-dasharray: 5 3;
  }
  .overlay .handle {
    fill: var(--canvas, #fff);
    stroke: var(--electric, #2f6fed);
    stroke-width: 2;
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
  /* Tonio adds a crosshair when the circle is too small to aim with, or so
     big the center is lost (tools.js DrawCursor). */
  .brush-cursor.cross::before,
  .brush-cursor.cross::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    background: var(--ink);
    box-shadow: 0 0 0 1px var(--canvas);
    transform: translate(-50%, -50%);
  }
  .brush-cursor.cross::before {
    width: 11px;
    height: 1px;
  }
  .brush-cursor.cross::after {
    width: 1px;
    height: 11px;
  }
  /* Tonio draws a 25px swatch down-right of the pipette cursor. */
  .pick-preview {
    position: fixed;
    z-index: 30;
    width: 25px;
    height: 25px;
    margin: 10px 0 0 10px;
    border: 1px solid var(--ink);
    box-shadow: 0 0 0 1px var(--canvas);
    pointer-events: none;
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
