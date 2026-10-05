<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { toolSpec } from './panels';
  import { PENCIL } from '../plugins';
  import type { EditorState, Tool } from './editor-state.svelte';
  import { BACKGROUND_COLOR, CANVAS_LOGICAL_WIDTH, FIXED_POINT_SCALE } from '../format/constants';
  import type { Frame, Layer } from '../format/types';
  import { frameCount, placeStrokePoints, scaleToolWidth } from '../model/operations';
  import type { Viewport } from '../render/contract';
  import {
    renderRawPolyline,
    renderResolvedPreview,
    type BlitTarget,
    type Canvas2DLike,
  } from '../render/canvas2d';
  import { FrameComposer, type LiveLine } from '../render/frame-compose';
  import { isFilledLineTool } from '../render/dispatch';
  import { cursorShape, pickSource } from './frame-selection';
  import {
    hitMode,
    movedBy,
    rotatedTo,
    scaledBy,
    sessionWidthScale,
    type HitMode,
    type TransformSession,
  } from '../tools/lasso';
  import {
    clampPan,
    fitSheet,
    fitView,
    renderDensity,
    sheetBitmap,
    resizedView,
    toDocument,
    zoomAt,
    zoomCentredOn,
    zoomDelta,
    wheelNotch,
    ctrlWheelZoom,
    trackpadScroll,
    type Cover,
    type Stage,
  } from './viewport';
  import { brushWidthDoc } from '../tools/stroke-builder';
  import { SIZE_TRACK, positionOfSize, sizeAtRail, sizeByKey, sizeFromDrag } from './size-scale';
  import type { LineToolDescriptor } from '../format/types';
  import {
    PointerStrokeController,
    swapStrokeColours,
    previewStrokeSession,
    previewStrokePressure,
    drawsPressure,
    type PointerSample,
  } from '../tools/profiles';
  import type { StrokeRules } from '../plugins/contract';
  import { t } from '../i18n';
  import { HOLD_PICK_MS, mayHoldPick, stillHeld } from './hold-pick';
  import { nextHint } from './canvas-hint';
  import { createSideButtonGuard } from './side-buttons';

  let { editor }: { editor: EditorState } = $props();

  // The visible context needs a few more members than the pure Canvas2DLike/
  // BlitTarget seam (alpha compositing, clearing). It is a real 2D context.
  type ViewCtx = Canvas2DLike &
    BlitTarget & {
      globalAlpha: number;
      clearRect(x: number, y: number, w: number, h: number): void;
      strokeRect(x: number, y: number, w: number, h: number): void;
      imageSmoothingEnabled: boolean;
      imageSmoothingQuality: string;
      drawImage(image: CanvasImageSource, x: number, y: number, w: number, h: number): void;
    };

  let canvasEl: HTMLCanvasElement;
  let wrapWidth = $state(CANVAS_LOGICAL_WIDTH);
  let wrapHeight = $state(0);
  let cursorX = $state(0);
  let cursorY = $state(0);
  let cursorVisible = $state(false);
  /** Color the pipette would take, shown next to the cursor (Tonio). */
  let pickPreview = $state<string | null>(null);
  /**
   * Shift+drag sizing the brush (Krita): where it was pressed, the size it
   * started from and the one it has reached. Nothing is written until it ends.
   */
  let sizing = $state<{ pointerId: number; x: number; y: number; start: number; size: number } | null>(null);
  /**
   * The finger's way to the thickness (Procreate Dreams' sidebar): a vertical
   * rail on the edge of the stage, for a hand that touches — a coarse pointer
   * or the first finger seen. Held (a finger, or a key a moment), it shows the
   * ring in the middle of the stage, at the sheet's scale.
   */
  let touchSeen = $state(false);
  let railHeld = $state<{ pointerId: number; x: number; y: number } | null>(null);
  let railTrack = $state<HTMLElement>();
  /** The size ring of a gesture: the Shift+drag where it began, the rail in the middle. */
  const ring = $derived(
    sizing ? { x: sizing.x, y: sizing.y, size: sizing.size }
    : railHeld ? { x: railHeld.x, y: railHeld.y, size: editor.brushSizeLogical }
    : null,
  );
  function holdRail(pointerId: number): void {
    const r = canvasRect();
    railHeld = { pointerId, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function railTo(e: PointerEvent): void {
    const r = railTrack!.getBoundingClientRect();
    // Through the slider's own setter: clamped, saved to the brush record.
    editor.brushSizeLogical = sizeAtRail(e.clientY, r.top, r.height, editor.brushRange.min, editor.brushSizeMax);
  }
  function onRailDown(e: PointerEvent): void {
    // Through the preview the rail stays, like the fps slider, and does nothing.
    if (editor.playing || !e.isPrimary || e.button !== 0) return;
    // The palm by the pen, as on the sheet: a left hand drawing by the edge
    // rests on the rail, and the size jumped under it.
    if (e.pointerType === 'touch' && editor.penSeen && penBusy()) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    holdRail(e.pointerId);
    // A tap jumps there (Procreate), a drag follows.
    railTo(e);
  }
  function onRailMove(e: PointerEvent): void {
    if (railHeld?.pointerId === e.pointerId) railTo(e);
  }
  function onRailUp(e: PointerEvent): void {
    if (railHeld?.pointerId === e.pointerId) railHeld = null;
  }
  function onRailKey(e: KeyboardEvent): void {
    // Alt+← is «back», Ctrl+Shift+arrows pan the sheet: neither is a size.
    if (editor.playing || e.ctrlKey || e.altKey || e.metaKey) return;
    const next = sizeByKey(e.key, editor.brushSizeLogical, editor.brushRange.min, editor.brushSizeMax, editor.ux);
    if (next === null) return;
    e.preventDefault();
    editor.brushSizeLogical = next;
    holdRail(-1);
  }
  // A finger or a key on the rail when the film starts lets go: the ring
  // must not stay in the middle of the stage through the preview.
  $effect(() => {
    if (editor.playing) railHeld = null;
  });
  /** A finger held still, waiting to become the pipette (hold-pick.ts). */
  let hold: { pointerId: number; x: number; y: number; timer: number } | null = null;
  /**
   * The pipette a held finger brought (Procreate Dreams' eyedropper): where
   * the finger is, the colour under it, and whether it is off the sheet.
   */
  let dropper = $state<{ pointerId: number; x: number; y: number; color: string | null; off: boolean } | null>(null);
  function cancelHold(): void {
    if (hold) {
      clearTimeout(hold.timer);
      hold = null;
    }
  }
  // A finger still on the glass when the studio goes away must not wake a
  // pipette, a hint or a zoom end on a canvas that is gone.
  onDestroy(() => {
    cancelHold();
    clearTimeout(hintTimer);
    // The pixels go with the canvas, now rather than when the collector gets
    // to them: Safari caps canvas memory, and a studio opened and left a few
    // times over held ten stage-sized buffers each. A frame already asked for
    // must not build them all again on a canvas that is gone.
    destroyed = true;
    cancelAnimationFrame(rafId);
    composer.dispose();
    for (const spare of [sheetEl, pickEl, canvasEl]) {
      if (spare) {
        spare.width = 0;
        spare.height = 0;
      }
    }
  });
  /** Pointer that is panning the canvas (middle button or the hand). */
  let panning = $state<{ pointerId: number; x: number; y: number } | null>(null);
  /** Active touch points, for two-finger pan and pinch. */
  const touches = new Map<number, { x: number; y: number }>();
  /** Pointers the canvas holds captured; the editor keys wait for all of them. */
  const heldPointers = new Set<number>();
  let gesture: { distance: number; midX: number; midY: number; zoom: number } | null = null;
  /** Live mega-eraser gesture in document units, or null when idle. */
  let megaGesture = $state<number[] | null>(null);
  /** The cell the sweep began on, pinned like the line's. */
  let megaAt: { layer: Layer | undefined; cell: Frame | undefined } = { layer: undefined, cell: undefined };
  /** Pointer owning the mega-eraser or distort gesture — only one runs at a time. */
  let gesturePointerId = -1;
  /** Pointer holding a gesture a tool brought itself (plugins/contract.ts). */
  let pluginGrab: { pointerId: number; spec: NonNullable<ReturnType<typeof toolSpec>> } | null = null;
  /**
   * Drag inside an open transform: which zone was pressed, the session it
   * started from, where it started (document units), the axis shift locked,
   * and whether it has moved yet — the whole drag is one step of the session.
   */
  let grab: {
    pointerId: number;
    mode: HitMode;
    base: TransformSession;
    x: number;
    y: number;
    axis: 'x' | 'y' | null;
    moved: boolean;
  } | null = null;
  /** Zone the pointer hovers inside an open transform — only the cursor reads it. */
  let hoverMode = $state<HitMode>('none');
  let lastPickPreview = 0;
  const PIPETTE_THROTTLE_MS = 100;
  /** Transient message over the canvas (e.g. drawing into a hidden layer). */
  let hint = $state('');
  let hintTimer = 0;
  /**
   * The rules the gesture runs under: the tool's own when it declared some,
   * the preset's brush otherwise. Which brush that is, is the preset's
   * business — the canvas only asks for the rules.
   */
  function activeRules(): StrokeRules {
    return editor.brushRules;
  }

  /**
   * Descriptor for the active tool, frozen into the session at pointerdown.
   * The tool builds it: the canvas hands over the brush in hand and knows
   * nothing about which tool is which, nor what it lays down.
   */
  function activeDescriptor(): LineToolDescriptor {
    return (toolSpec(editor.brushTool)?.stroke ?? PENCIL).descriptor({
      ...editor.pluginBrush,
      width: brushWidthDoc(editor.brushSizeLogical),
    });
  }

  /**
   * Button the live stroke was started with. Anything but the left one draws
   * with the fill colour (reference: `c.c = fillColour` for the gesture).
   */
  let strokeButton = 0;

  const pointer = new PointerStrokeController(() => ({
    rules: activeRules(),
    descriptor: strokeButton === 0
      ? activeDescriptor()
      : swapStrokeColours(activeDescriptor(), editor.fillColor),
    zoom: editor.view.zoom,
  }));
  /**
   * Layer pinned at pointerdown — the object, not its index: a reorder during
   * the gesture would make an index point at a different layer.
   */
  let strokeLayer: Layer | undefined;
  /**
   * And the cell, the object too: a finger tapping another frame on the strip
   * while the pen drew landed the line there, and a frame put in front of it
   * shifted an index onto the neighbour.
   */
  let strokeCell: Frame | undefined;

  /**
   * The frame itself: the layers around the active one, the ghosts of the
   * onion between them and the line under the hand. The same composer the
   * benchmark runs, so what is measured there is what is drawn here.
   */
  const composer = new FrameComposer();
  /** The paper and its shadow, and the shape they were drawn for. */
  /** Scratch the pipette flattens the frame into before reading a pixel back. */
  let pickEl: HTMLCanvasElement | null = null;
  let rafPending = false;
  let rafId = 0;
  /** The canvas was unmounted: nothing is drawn any more. */
  let destroyed = false;

  /**
   * Stable id per gesture object. A key built from a count collides after the
   * gesture is replaced; object identity does not.
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


  // What stands over the stage for good (`data-over-sheet`: the thickness
  // rail, the zoom window), in the wrap's px. The sheet at 100 % is fitted
  // clear of it (the owner, after the thirteenth audit: the rail lay over
  // 45 px of the page on a phone). Not while the film plays: the sheet is
  // not to jump then.
  let wrapEl = $state<HTMLDivElement | undefined>();
  let covers = $state<Cover[]>([]);
  /** A cover moved while a hand was on the sheet; measured once it lets go. */
  let coversStale = false;
  function measureCovers(): void {
    if (!wrapEl || editor.playing) return;
    // The first finger brings the rail, and a refit under it moved the sheet
    // while that same finger was drawing: the line jumped. It waits.
    if (drawingBusy() || touches.size > 0) {
      coversStale = true;
      return;
    }
    coversStale = false;
    const box = wrapEl.getBoundingClientRect();
    const next = [...(wrapEl.parentElement ?? wrapEl).querySelectorAll<HTMLElement>('[data-over-sheet]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left - box.left), y: Math.round(r.top - box.top), width: Math.round(r.width), height: Math.round(r.height) };
    });
    if (JSON.stringify(next) !== JSON.stringify(covers)) covers = next;
  }
  /** The hand let go: a cover that moved under it is measured now. */
  function settleCovers(): void {
    if (coversStale) {
      measureCovers();
    }
  }
  // A cover appears (the first finger), goes (display: none) or is resized
  // (text zoom); the wrap's own resize moves the corner ones.
  $effect(() => {
    void editor.playing;
    void touchSeen;
    if (!wrapEl || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measureCovers());
    observer.observe(wrapEl);
    for (const el of (wrapEl.parentElement ?? wrapEl).querySelectorAll('[data-over-sheet]')) observer.observe(el);
    return () => observer.disconnect();
  });
  // The sheet at 100%: the document fitted inside the wrap (whose size the
  // page layout sets, not the canvas itself), with air around it.
  // Its size is all the fit reads of the document: every stroke replaces the
  // document, and a fit that read the whole of it re-laid the sheet and wrote
  // the view anew per line.
  const docWidth = $derived(editor.doc.width);
  const docHeight = $derived(editor.doc.height);
  const sheet = $derived(
    fitSheet(wrapWidth || CANVAS_LOGICAL_WIDTH, wrapHeight > 0 ? wrapHeight : Infinity,
      { width: docWidth, height: docHeight }, covers),
  );
  const sheetWidth = $derived(sheet.width);
  const sheetHeight = $derived(sheet.height);
  /**
   * The worktable: the canvas element is the whole workspace and the sheet
   * lies on it, so zoom magnifies the paper rather than the window, and the
   * pan walks around a sheet whose edges are visible.
   */
  const stage = $derived<Stage>({
    width: Math.max(1, wrapWidth || sheetWidth),
    height: Math.max(1, wrapHeight || sheetHeight),
    sheetWidth,
    sheetHeight,
    sheetX: sheet.x,
    sheetY: sheet.y,
  });
  // The canvas is the product. Without a role and a name it lands in the
  // accessibility tree as an anonymous box, so it says what it is and which
  // frame is on it.
  const canvasLabel = $derived(
    t('canvas.label', { frame: editor.displayedFrame + 1, total: frameCount(editor.doc) })
      + (editor.doc.layers.length > 1 ? t('canvas.label_layer', { layer: editor.layerLabel(editor.activeLayer) }) : ''),
  );
  /** Reference cursors for the transform zones (`tools.js:995-1032`). */
  const CURSOR_BY_MODE: Record<HitMode, string> = {
    move: 'move',
    rotate: 'crosshair',
    'scale-u': 'ns-resize',
    'scale-d': 'ns-resize',
    'scale-l': 'ew-resize',
    'scale-r': 'ew-resize',
    'scale-ul': 'nwse-resize',
    'scale-dr': 'nwse-resize',
    'scale-ur': 'nesw-resize',
    'scale-dl': 'nesw-resize',
    none: '',
  };
  /** A real CSS cursor while a transform or the distort brush owns the canvas. */
  const overlayCursor = $derived(
    toolSpec(editor.tool)?.cursor
      ? toolSpec(editor.tool)!.cursor!
      : editor.tool === 'drag'
        ? (panning ? 'grabbing' : 'grab')
        : editor.transform
          ? CURSOR_BY_MODE[hoverMode] || (editor.tool === 'lasso' ? 'default' : '')
          // The lasso lays no line: a press takes the frame, so no brush ring.
          : editor.tool === 'lasso'
            ? 'default'
            : '',
  );

  /** Screen pixels per document unit — what the transform hit thresholds scale by. */
  const hitZoom = $derived(Math.max(1e-6, (sheetWidth * editor.view.zoom) / editor.doc.width));
  /**
   * How much further a finger reaches a transform handle than the mouse: the
   * handles are ±10 px, a 20 px target under a ~34 px fingertip (2.5.8 asks 24).
   */
  const TOUCH_REACH = 1.5;
  function hitScale(e: PointerEvent): number {
    return e.pointerType === 'touch' ? hitZoom / TOUCH_REACH : hitZoom;
  }
  /**
   * The brush width in screen pixels — what the ring, the square and the grid
   * measure. A pixel is a pixel: the width the slider shows is the width that
   * lands, and only the view (fit and zoom) stands between them.
   */
  const cursorDiameter = $derived(diameterOf(editor.brushSizeLogical));
  function diameterOf(size: number): number {
    return Math.max(1, (size * sheetWidth * editor.view.zoom) / (editor.doc.width / FIXED_POINT_SCALE));
  }
  /** Ring, cross, or the cross alone for a brush too thin to draw a circle for. */
  const cursorParts = $derived(cursorShape(editor.brushSizeLogical, editor.ux.crossCursor && editor.settings.crossCursor));

  /** The workspace the sheet was last laid out on; null until it is measured. */
  let placedStage: Stage | null = null;
  // The zoom buttons clamp against the worktable, which only the view knows.
  // The first measured workspace lays the sheet in the middle of it; later
  // ones (a panel dragged, the window turned) keep what was in the middle of
  // the screen there — the sheet is refitted, so the old pan pointed elsewhere.
  $effect(() => {
    editor.stage = stage;
    editor.view = untrack(() => (placedStage ? resizedView(editor.view, placedStage, stage) : fitView(stage)));
    placedStage = wrapWidth > 0 && wrapHeight > 0 ? stage : null;
  });

  /**
   * The frame as it was last composed: the sheet, one pixel of it per logical
   * pixel of the document, whatever the window, the zoom or the screen. A
   * zoom or a pan stretches this picture and composes nothing — which is what
   * rebuilding every layer and ghost per movement of the sheet used to cost.
   */
  let sheetEl: HTMLCanvasElement | null = null;
  /** Whether the sheet is to be composed again. A change of view leaves it. */
  let sheetStale = true;

  function draw(): void {
    if (!canvasEl || destroyed) {
      return;
    }
    // The visible canvas is the table, at the screen's density under its cap.
    // The sheet lying on it keeps the document's own.
    const dpr = renderDensity(window.devicePixelRatio || 1);
    const pxWidth = Math.max(1, Math.round(stage.width * dpr));
    const pxHeight = Math.max(1, Math.round(stage.height * dpr));
    if (canvasEl.width !== pxWidth) {
      canvasEl.width = pxWidth;
    }
    if (canvasEl.height !== pxHeight) {
      canvasEl.height = pxHeight;
    }
    // Safari hands out no context once canvas memory runs out: nothing is
    // drawn, rather than a TypeError every animation frame.
    const ctx = canvasEl.getContext('2d') as unknown as ViewCtx | null;
    if (!ctx) {
      return;
    }
    const frame = editor.displayedFrame;
    if (!editor.doc.layers[0]?.frames[frame]) {
      return;
    }
    // ponytail: the sheet is the document's size whatever the device — a 4K
    // document is ~33 MB a buffer and the composer keeps about ten. Cap the
    // bitmap by the device's memory if a phone reloads on one.
    const bitmap = sheetBitmap(editor.doc);
    sheetEl = buffer(sheetEl, bitmap.width, bitmap.height);
    if (sheetStale) {
      const sheetCtx = sheetEl.getContext('2d') as unknown as ViewCtx | null;
      if (!sheetCtx) {
        return;
      }
      const viewport = { scale: bitmap.width / editor.doc.width, dpr: 1 };
      sheetCtx.setTransform(1, 0, 0, 1, 0, 0);
      sheetCtx.clearRect(0, 0, bitmap.width, bitmap.height);
      // The frame itself — the layers around the active one, the ghosts, the
      // line under the hand — is put together by the shared composer, the same
      // one the benchmark runs. What is left here is the editor's canvas: the
      // paper the frame lies on and a tool's grid over it.
      composer.compose(sheetCtx, bitmap.width, bitmap.height, {
        doc: editor.doc,
        frame,
        activeLayer: editor.activeLayer,
        viewport,
        tools: previewTools,
        cellAt: stackCell,
        ghosts: editor.showOnionSkin
          ? { frames: editor.onionSkinLayers, layers: editor.onionHistoryLayerIndices }
          : undefined,
        live: liveLine(viewport),
        // The profile's active alpha (Multator: 0.8, its containerSprite)
        // applies to the whole current frame.
        alpha: editor.playing ? 1 : editor.ux.activeFrameAlpha,
      });
      sheetStale = false;
    }

    const sheet = {
      x: editor.view.panX * dpr,
      y: editor.view.panY * dpr,
      w: sheetWidth * editor.view.zoom * dpr,
      h: sheetHeight * editor.view.zoom * dpr,
    };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pxWidth, pxHeight);
    // The paper lies flat on the table: white on the table's tone, no shadow.
    ctx.fillStyle = BACKGROUND_COLOR;
    ctx.fillRect(sheet.x, sheet.y, sheet.w, sheet.h);
    // Magnified, the sheet shows its pixels, as a sheet of them does; shrunk
    // to fit, it is smoothed, or a thin line breaks into dots.
    ctx.imageSmoothingEnabled = sheet.w <= bitmap.width;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sheetEl, sheet.x, sheet.y, sheet.w, sheet.h);
    // The grid is a drawing aid, not part of the picture: the preview shows
    // the frames as they will be exported.
    if (toolSpec(editor.brushTool)?.stroke?.grid && !editor.playing) {
      drawPixelGrid(ctx, pxWidth, pxHeight, dpr, sheet);
    }
    // A hairline edge, so the paper reads as a sheet even over a white table.
    // The value is `--hairline` (14% ink), written out because a 2D context
    // takes a string and not a custom property.
    // ponytail: held to the token by `system-craft.test.ts`, not read from the
    // computed style — one read at mount if a theme ever moves this hue.
    ctx.strokeStyle = 'rgba(11, 12, 16, 0.141)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(sheet.x) + 0.5, Math.round(sheet.y) + 0.5, Math.round(sheet.w), Math.round(sheet.h));
  }

  /**
   * The pixel tool's grid, one line per cell (reference `tools.js:346-357`).
   * `difference` keeps it visible over both the white page and a black
   * stroke without a colour of its own.
   */
  function drawPixelGrid(
    ctx: ViewCtx,
    pxWidth: number,
    pxHeight: number,
    dpr: number,
    sheet: { x: number; y: number; w: number; h: number },
  ): void {
    const step = cursorDiameter * dpr;
    if (step < 4) {
      // Denser than this the grid is a grey wash, not a guide.
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'difference';
    ctx.strokeStyle = '#303030';
    ctx.lineWidth = 1;
    ctx.beginPath();
    // On the paper only: the grid is the sheet's, and the table has no cells.
    const left = Math.max(0, sheet.x);
    const top = Math.max(0, sheet.y);
    const right = Math.min(pxWidth, sheet.x + sheet.w);
    const bottom = Math.min(pxHeight, sheet.y + sheet.h);
    for (let x = sheet.x + Math.ceil((left - sheet.x) / step) * step; x < right; x += step) {
      ctx.moveTo(Math.round(x) + 0.5, top);
      ctx.lineTo(Math.round(x) + 0.5, bottom);
    }
    for (let y = sheet.y + Math.ceil((top - sheet.y) / step) * step; y < bottom; y += step) {
      ctx.moveTo(left, Math.round(y) + 0.5);
      ctx.lineTo(right, Math.round(y) + 0.5);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Tool table the stack draws with. While "change width with scale" is on,
   * a scaled copy of every tool is appended, so the selection is previewed at
   * the width Enter will actually write — no jump on apply.
   */
  const previewTools = $derived.by(() => {
    const open = editor.transform;
    if (!open?.widthWithScale) {
      return editor.doc.tools;
    }
    const scale = sessionWidthScale(open.session);
    return [...editor.doc.tools, ...editor.doc.tools.map((tool) => scaleToolWidth(tool, scale))];
  });

  /**
   * A layer's cell as the stack should draw it: the lasso takes whole cells,
   * so a selected one is rasterized already moved rather than left in its old
   * place with a preview on top.
   */
  function stackCell(layer: number, frame: number): Frame | undefined {
    const cell = editor.doc.layers[layer]?.frames[frame];
    const open = editor.transform;
    if (!cell || !open || frame !== editor.activeFrame || !open.layers.includes(layer)) {
      return cell;
    }
    return {
      strokes: cell.strokes.map((stroke) => {
        // The scaled copies sit right after the real table, at the same offsets.
        // The same placing apply will perform, so the drag shows the real
        // result instead of a smooth version of it that snaps on Enter.
        const tool_id = open.widthWithScale ? stroke.tool_id + editor.doc.tools.length : stroke.tool_id;
        const points = placeStrokePoints(
          stroke.points,
          (x, y) => editor.transformPoint(x, y),
          editor.doc.tools[stroke.tool_id],
          previewTools[tool_id],
        );
        return { ...stroke, points, tool_id };
      }),
    };
  }

  /**
   * The eight handles where they are drawn now: the box corners run through
   * the session, plus the side midpoints between them (the session is affine,
   * so a midpoint stays a midpoint).
   */
  const displayedHandles = $derived.by(() => {
    const open = editor.transform;
    if (!open) {
      return null;
    }
    const { x, y, width: w, height: h } = open.box;
    const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
      .map(([cx, cy]) => editor.transformPoint(cx, cy));
    const out: number[] = [];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corners[i];
      const [bx, by] = corners[(i + 1) % 4];
      out.push(ax, ay, (ax + bx) / 2, (ay + by) / 2);
    }
    return out;
  });

  /** Document units → CSS pixels inside the canvas element (the overlay's frame). */
  function toScreen(x: number, y: number): [number, number] {
    return [
      editor.view.panX + (x / editor.doc.width) * sheetWidth * editor.view.zoom,
      editor.view.panY + (y / editor.doc.height) * sheetHeight * editor.view.zoom,
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
   * The line under the hand, as the composer takes it.
   *
   * A pencil whose path is read as a polyline or a smooth chain is handed over
   * as points: the composer keeps the settled part of it and draws only what
   * still moves. An eraser cuts alpha and a feather fills what it encloses —
   * what either of them paints depends on the whole figure, so they hand over
   * the way to paint it instead. The mega eraser is one of the latter: its
   * gesture punches alpha on top of the layer the way the reference does,
   * while the strokes are only rewritten on release.
   */
  function liveLine(viewport: Viewport): LiveLine | null {
    // The trail is drawn over the cell the release cuts, not another frame
    // a finger made active meanwhile.
    if (megaGesture && megaGesture.length >= 2 && megaAt.cell === editor.activeCell) {
      const gesture = megaGesture;
      return {
        id: nodeId(gesture),
        erase: true,
        paint: (target) => renderRawPolyline(
          gesture,
          // The width the gesture really cuts with: the cut on release takes
          // the same normalised radius, and so does the cursor ring.
          brushWidthDoc(editor.brushSizeLogical),
          BACKGROUND_COLOR,
          target,
          viewport,
        ),
      };
    }
    const session = pointer.session;
    if (!session || strokeLayer !== editor.doc.layers[editor.activeLayer] || strokeCell !== editor.activeCell) {
      return null;
    }
    const erase = session.descriptor.kind === 'eraser';
    const color = erase ? BACKGROUND_COLOR : session.descriptor.color;
    const geometry = session.rules.previewGeometry ?? session.descriptor.geometry;
    // A pen's line changes width along it and is redrawn whole, like a feather —
    // where the brush takes the pressure; one that does not grows as under a mouse.
    const grows = !drawsPressure(session) && session.descriptor.kind === 'pencil'
      && (geometry === 'line' || geometry === 'smooth');
    if (!grows) {
      return {
        id: nodeId(session),
        erase,
        paint: (target) => renderSessionPreview(session, target, viewport, color),
      };
    }
    return {
      id: nodeId(session),
      points: session.rules.previewGeometry === 'line'
        ? session.rawPoints
        : previewStrokeSession(session),
      geometry,
      width: session.descriptor.width,
      color,
    };
  }

  function renderSessionPreview(
    session: NonNullable<typeof pointer.session>,
    target: Canvas2DLike,
    viewport: Viewport,
    color: string,
  ): void {
    const raw = session.rules.previewGeometry === 'line';
    const points = raw ? session.rawPoints : previewStrokeSession(session);
    const pressure = previewStrokePressure(session, points);
    if (pressure) {
      // The pen's line under the hand has the width it will land with.
      const tool = raw ? { ...session.descriptor, geometry: 'line' as const } : session.descriptor;
      renderResolvedPreview(points, tool as LineToolDescriptor, color, target, viewport, pressure);
      return;
    }
    if (session.rules.previewGeometry === 'line') {
      // The reference press is a bare moveTo: the dot appears on release.
      if (session.rawPoints.length < 4) return;
      renderRawPolyline(
        session.rawPoints,
        session.descriptor.width,
        color,
        target,
        viewport,
        // A feather fills what it encloses while it is being drawn too.
        isFilledLineTool(session.descriptor) ? session.descriptor.fill : undefined,
      );
    } else {
      renderResolvedPreview(previewStrokeSession(session), session.descriptor, color, target, viewport);
    }
  }

  /** Long enough to read a sentence, not only a word (2.2.1). */
  const HINT_MS = 3000;
  function showHint(message: string): void {
    // The same words twice are still news to the live region (canvas-hint.ts).
    hint = nextHint(hint, message);
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (hint = ''), HINT_MS) as unknown as number;
  }

  // The swatch by the pipette is what lay under it when it last looked: back
  // in hand after another tool, it showed a colour taken long ago until the
  // mouse moved. It waits for the next move instead.
  $effect(() => {
    void editor.tool;
    pickPreview = null;
  });

  /**
   * Where the loupe of a held finger stands across the screen: over the
   * finger, but whole — by the right edge half of it was off the glass.
   */
  function loupeX(x: number): number {
    const half = 40;
    return Math.min(Math.max(x, half), Math.max(half, window.innerWidth - half));
  }

  // Why a tool did nothing, when the state is the one that knows (the lasso on
  // an empty frame, a locked transform) — said in the same live line.
  // `showHint` reads the hint it writes: heard here, the effect ran on its own
  // write, and the timer that cleared the hint sent it round without end —
  // the studio answered nothing until a reload.
  $effect(() => {
    const said = editor.canvasHint;
    if (said) untrack(() => showHint(said.text));
  });

  /** Asks for a frame. `stale` false is a change of view: the sheet is shown again as it is. */
  function scheduleDraw(stale = true): void {
    sheetStale ||= stale;
    if (rafPending) {
      return;
    }
    rafPending = true;
    rafId = requestAnimationFrame(() => {
      rafPending = false;
      draw();
    });
  }

  $effect(() => {
    // Everything the three buffers are built from. The document is one value
    // and a write replaces it, so reading it here is the whole subscription —
    // the walk over every layer's cell that used to stand for it is gone, and
    // with it a read per cell per stroke.
    void editor.doc;
    void editor.displayedFrame;
    void editor.activeLayer;
    void editor.showOnionSkin;
    void editor.onionHistoryLayerIndices.length;
    void editor.ux;
    void editor.transform;
    void editor.playing;
    composer.invalidate();
    scheduleDraw();
  });

  // The view moves the sheet, not what is drawn on it: a zoom, a pan or a
  // table resized puts the same picture elsewhere on the screen.
  $effect(() => {
    void stage;
    void editor.view;
    scheduleDraw(false);
  });

  // The pixel grid is painted over the composited stack, so picking the tool
  // or resizing its cell repaints the canvas — without invalidating buffers
  // that have not changed.
  $effect(() => {
    void editor.tool;
    void editor.playing;
    void cursorDiameter;
    scheduleDraw(false);
  });

  // A window dragged to a screen of another density changes nothing else the
  // canvas watches — the stage keeps its CSS size — so the table stayed at the
  // old screen's density. The screen itself says when it changes.
  $effect(() => {
    let query: MediaQueryList;
    const moved = (): void => {
      scheduleDraw(false);
      watch();
    };
    const watch = (): void => {
      query = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      query.addEventListener('change', moved, { once: true });
    };
    watch();
    return () => query.removeEventListener('change', moved);
  });

  /**
   * Where the canvas sits on the screen. One layout query, handed down: a
   * `pointermove` carrying eight coalesced samples used to ask eight times
   * for a rectangle that cannot have moved between them.
   */
  function canvasRect(): DOMRect {
    return canvasEl.getBoundingClientRect();
  }

  function toDocUnits(
    e: { clientX: number; clientY: number },
    rect: DOMRect = canvasRect(),
  ): [number, number] {
    return toDocument(
      e.clientX - rect.left,
      e.clientY - rect.top,
      { width: sheetWidth, height: sheetHeight },
      editor.doc,
      editor.view,
    );
  }

  /** The pointer is on the table, beside the sheet rather than over it. */
  function offSheet(e: { clientX: number; clientY: number }): boolean {
    const [x, y] = toDocUnits(e);
    return x < 0 || y < 0 || x >= editor.doc.width || y >= editor.doc.height;
  }

  /**
   * Color under the pointer. "Canvas" reads the visible composite of the
   * current frame (no onion, no live stroke); "Layer" reads the active layer
   * alone. Alt takes the layer for this click without changing the setting.
   * A transparent pixel is the background.
   */
  /**
   * Colour under the pointer, null where the canvas is not fully opaque, and
   * undefined when there is nothing to read — no frame composed yet (right
   * after a lost context) or no context for the scratch (Safari out of canvas
   * memory). Emptiness arms the eraser; not being able to look must not.
   */
  function pickColor(e: { clientX: number; clientY: number; altKey: boolean }): string | null | undefined {
    const source = pickSource(editor.pickSource, e.altKey);
    // The frame as it was composed, off the composer's own buffers: no paper
    // under it, no onion over it and no line under the hand.
    const layers = composer.layers;
    if (!layers) {
      return undefined;
    }
    // Those buffers are the sheet, a pixel per document pixel: the spot of the
    // document under the pointer is the pixel, whatever the view shows it at.
    const read = layers.active as HTMLCanvasElement;
    const [x, y] = toDocUnits(e);
    const px = Math.min(read.width - 1, Math.max(0, Math.floor((x / editor.doc.width) * read.width)));
    const py = Math.min(read.height - 1, Math.max(0, Math.floor((y / editor.doc.height) * read.height)));
    // One pixel is all it reads, so one pixel is all it flattens: the layers
    // land shifted onto a 1×1 scratch. A stage-sized copy was three full blits
    // every 100 ms of the preview and megabytes held for the rest of the session.
    pickEl = buffer(pickEl, 1, 1);
    // Made for reading: the preview reads a pixel back every 100 ms, and a
    // GPU-backed scratch paid a full readback for each.
    const pctx = pickEl.getContext('2d', { willReadFrequently: true }) as unknown as ViewCtx | null;
    if (!pctx) {
      return undefined;
    }
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.clearRect(0, 0, 1, 1);
    if (source === 'canvas') {
      pctx.drawImage(layers.below, -px, -py);
    }
    pctx.drawImage(layers.active, -px, -py);
    if (source === 'canvas') {
      pctx.drawImage(layers.above, -px, -py);
    }
    const [r, g, b, a] = (pctx as unknown as CanvasRenderingContext2D).getImageData(0, 0, 1, 1).data;
    // Reference: only a fully opaque pixel carries a colour. The soft rim of
    // a stroke reads as emptiness, so the pipette never picks a washed-out
    // version of the line it was aimed at.
    if (a !== 255) {
      return null;
    }
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  /**
   * The pipette's take: the colour under the pointer into the outline or the
   * fill; emptiness arms the eraser and keeps both colours (reference: alpha
   * ≠ 255) — through the rules, so an eraser taken off the panel is not armed.
   * The tool and the held finger both come here. Returns what it took.
   */
  function takeColour(e: { clientX: number; clientY: number; altKey: boolean }, toFill: boolean): string | null {
    const picked = pickColor(e);
    if (picked === undefined) {
      return null;
    }
    if (picked === null) {
      editor.selectTool('eraser');
      return null;
    }
    editor.pickColor(picked, toFill ? 'fill' : 'outline');
    return picked;
  }

  /**
   * The finger stayed put: whatever it began while waiting goes, unrecorded —
   * the line (no step to undo), the pan, the mega eraser's sweep — and the
   * pipette with its loupe takes the finger.
   */
  function startDropper(): void {
    if (!hold) {
      return;
    }
    const { pointerId, x, y } = hold;
    hold = null;
    if (touches.size > 1) {
      return;
    }
    if (pointer.discard()) {
      strokeLayer = undefined;
    }
    dropOwnGesture();
    panning = null;
    try {
      canvasEl.setPointerCapture(pointerId);
    } catch {
      // The finger left in the same tick; its pointerup ends nothing.
    }
    dropper = { pointerId, x, y, color: null, off: false };
    aimDropper({ clientX: x, clientY: y, altKey: false });
    scheduleDraw();
  }

  function aimDropper(e: { clientX: number; clientY: number; altKey: boolean }): void {
    if (!dropper) {
      return;
    }
    const off = offSheet(e);
    dropper = { ...dropper, x: e.clientX, y: e.clientY, off, color: off ? null : pickColor(e) ?? null };
  }

  /** The finger lifted: the colour under it goes to the outline, as the pipette takes it. */
  function finishDropper(e: PointerEvent): void {
    const at = { clientX: e.clientX, clientY: e.clientY, altKey: false };
    dropper = null;
    // The table beside the sheet holds no colour: nothing is taken.
    if (offSheet(at)) {
      return;
    }
    // Unlike the pipette tool, an empty spot hands no eraser: a finger held a
    // little too long must not change what is in the hand.
    const picked = pickColor(at);
    if (picked === undefined) {
      return;
    }
    if (picked === null) {
      showHint(t('canvas.hold_empty'));
      return;
    }
    editor.pickColor(picked, 'outline', false, true);
    showHint(t('canvas.hold_picked', { color: picked }));
  }

  /**
   * Navigation gestures, before drawing gets a say: middle button or a held
   * space pans, two fingers pan and pinch. The first finger always lands
   * before the second, so the stroke it started is discarded rather than
   * committed: two fingers mean navigation, and nothing must be drawn.
   */
  function startNavigation(e: PointerEvent): boolean {
    if (e.pointerType === 'touch') {
      // A palm resting while the pen works is not a gesture: it would move
      // or pinch the sheet under the nib.
      if (editor.penSeen && penBusy()) {
        return true;
      }
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        cancelHold();
        dropper = null;
        if (pointer.discard()) {
          strokeLayer = undefined;
        }
        dropOwnGesture();
        // The hand's one-finger pan becomes the pinch, which pans too.
        panning = null;
        scheduleDraw();
        gesture = pinchFrom(touches);
        return true;
      }
      if (touches.size > 1) {
        return true;
      }
      // One finger: the hand below still pans with it.
    }
    // The hand is the tool whose whole job is this gesture (reference `Drag`);
    // once a pen has been used, a finger is always the hand.
    if (e.button === 1 || editor.tool === 'drag' || (e.pointerType === 'touch' && editor.penSeen)) {
      panning = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
      canvasEl.setPointerCapture(e.pointerId);
      return true;
    }
    return false;
  }

  /**
   * Lets go of whatever the canvas itself was holding — a handle, the mega
   * eraser's sweep, a tool's own drag — without applying the sweep. A tool's
   * drag is released, not rolled back: what it wrote so far is its business.
   */
  function dropOwnGesture(): void {
    // A handle is the session's, not the tool's: the step its drag filed goes
    // back — the first finger of a pinch lands on the selection more often
    // than not, and the zoom left the drawing shifted by its travel.
    if (grab?.moved) {
      editor.undoTransform();
    }
    grab = null;
    megaGesture = null;
    releasePluginGrab();
    gesturePointerId = -1;
  }

  /**
   * Lets go of a tool's own drag. The tool is a plugin's code: a release that
   * throws must still leave the canvas free and the gesture one step of undo —
   * held, it kept the wheel and the pinch dead, and every hover of the mouse
   * came back here to throw again.
   */
  function releasePluginGrab(): void {
    const held = pluginGrab;
    pluginGrab = null;
    gesturePointerId = -1;
    if (!held) {
      return;
    }
    try {
      held.spec.release?.(editor.pluginHost());
    } finally {
      editor.endPluginGesture();
    }
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
    editor.view = clampPan(
      { zoom: editor.view.zoom, panX: editor.view.panX + dx, panY: editor.view.panY + dy },
      stage,
    );
    editor.flashScaleMenu();
  }

  function zoomTo(zoom: number, clientX: number, clientY: number): void {
    const rect = canvasEl.getBoundingClientRect();
    // Unsnapped: the notches are for keys and the wheel, not for fingers.
    editor.view = zoomAt(editor.view, zoom, clientX - rect.left, clientY - rect.top, stage, false);
  }

  /** Wheel travel gathered toward the next notch (`wheelNotch`). */
  let wheelRest = 0;
  /** When the last trackpad scroll came (`e.timeStamp`), for `trackpadScroll`'s streak. */
  let trackpadAt = -Infinity;

  /**
   * Wheel zooms in the reference's 0.5 steps and recentres the view on the
   * cursor (`NormalizeCoords`). Ctrl+wheel — a Mac trackpad pinch among
   * them — zooms the sheet smoothly under the cursor, not the page. Two
   * fingers on a trackpad move the sheet (owner, after the fifteenth audit).
   * All of it works while the preview plays too.
   */
  function onWheel(e: WheelEvent): void {
    // Taken even when it zooms nothing: a sideways swipe left to the browser
    // is "back" in the history, and the drawing goes with it; Ctrl+wheel
    // would zoom the whole page.
    e.preventDefault();
    // Nor while a line is being drawn: the keys wait for it, and so does the
    // wheel — a zoom under the pen drew a straight line across the sheet.
    if (drawingBusy()) {
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      // A trackpad pinch is a stream of these.
      zoomTo(ctrlWheelZoom(editor.view.zoom, e.deltaY, e.deltaMode), e.clientX, e.clientY);
      editor.flashScaleMenu();
      return;
    }
    if (trackpadScroll(e, e.timeStamp - trackpadAt < WHEEL_ZOOM_IDLE_MS)) {
      trackpadAt = e.timeStamp;
      panBy(-e.deltaX, -e.deltaY);
      return;
    }
    const { notch, rest } = wheelNotch(wheelRest, e.deltaY, e.deltaMode);
    wheelRest = rest;
    if (notch === 0) {
      return;
    }
    const rect = canvasEl.getBoundingClientRect();
    editor.view = zoomCentredOn(
      editor.view,
      editor.view.zoom + zoomDelta(editor.view.zoom, notch),
      e.clientX - rect.left,
      e.clientY - rect.top,
      stage,
    );
    editor.flashScaleMenu();
  }

  /** How long a trackpad's wheel stream may pause before it counts as over, ms. */
  const WHEEL_ZOOM_IDLE_MS = 150;

  /**
   * Safari's trackpad pinch is not a Ctrl+wheel stream but WebKit's gesture
   * events; left alone they zoom the whole page, panels and all. They zoom
   * the sheet the way Ctrl+wheel does, from the zoom the pinch began at.
   */
  type PinchEvent = Event & { scale: number; clientX?: number; clientY?: number };
  let gestureZoom = 1;

  function onGestureStart(e: Event): void {
    e.preventDefault();
    gestureZoom = editor.view.zoom;
  }

  function onGestureChange(e: Event): void {
    e.preventDefault();
    // On iPad and iPhone the same pinch also arrives as pointers, which the
    // two-finger path already zooms by: only a trackpad has no touches.
    if (touches.size > 0 || drawingBusy()) {
      return;
    }
    const { scale, clientX, clientY } = e as PinchEvent;
    if (!Number.isFinite(scale) || scale <= 0) {
      return;
    }
    const rect = canvasRect();
    zoomTo(
      gestureZoom * scale,
      Number.isFinite(clientX) ? clientX! : rect.left + rect.width / 2,
      Number.isFinite(clientY) ? clientY! : rect.top + rect.height / 2,
    );
    editor.flashScaleMenu();
  }

  function onGestureEnd(e: Event): void {
    e.preventDefault();
  }

  /**
   * The stage the canvas lies in, with the windows that float over it — the
   * zoom window, the transform window, the notes. A pinch or Ctrl+wheel over
   * one of them zoomed the page, panels and all (owner, after the sixteenth
   * audit: it zooms the sheet).
   */
  function stageEl(): HTMLElement | undefined {
    return wrapEl?.parentElement ?? wrapEl;
  }

  /**
   * Ctrl+wheel over a window on the stage zooms the sheet. A plain wheel there
   * is the window's own scroll, and over the canvas the wrap hears it already.
   */
  function onStageWheel(e: WheelEvent): void {
    if (!(e.ctrlKey || e.metaKey) || !wrapEl || wrapEl.contains(e.target as Node)) {
      return;
    }
    onWheel(e);
  }

  // On the whole stage, the thickness rail and the floating windows over it
  // included: a pinch there zoomed the page, panels and all.
  $effect(() => {
    const el = stageEl();
    if (!el) return;
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    el.addEventListener('gestureend', onGestureEnd);
    el.addEventListener('wheel', onStageWheel, { passive: false });
    return () => {
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
      el.removeEventListener('wheel', onStageWheel);
    };
  });

  /**
   * The GPU reset or the tab was backgrounded on a phone: the browser gave
   * the canvas back blank, and every buffer behind it with it. The composer
   * still took them for drawn — the sheet stayed empty until something
   * changed, and the ghosts until their frame did. They all start afresh.
   */
  function onContextRestored(): void {
    composer.dispose();
    scheduleDraw();
  }

  $effect(() => {
    const el = canvasEl;
    el.addEventListener('contextrestored', onContextRestored);
    return () => el.removeEventListener('contextrestored', onContextRestored);
  });

  /** The tool the pen's eraser end took over from, given back when it flips. */
  let penFlippedFrom: Tool | null = null;

  /**
   * A pen turned over presses with its eraser end (button 5 — Wacom,
   * Surface and the like): that end erases, like
   * in every drawing program, and the pen's tip gets its own tool back.
   */
  function followPenEnd(e: PointerEvent): void {
    if (e.pointerType !== 'pen' || editor.transform) {
      return;
    }
    const eraserEnd = e.button === 5 || (e.buttons & 32) !== 0;
    if (eraserEnd && penFlippedFrom === null && editor.tool !== 'eraser') {
      const from = editor.tool;
      editor.selectTool('eraser');
      if (editor.tool === 'eraser') {
        penFlippedFrom = from;
      }
    } else if (!eraserEnd && penFlippedFrom !== null) {
      // Only if the eraser is still in hand: a tool picked since wins.
      if (editor.tool === 'eraser') {
        editor.restoreTool(penFlippedFrom);
      }
      penFlippedFrom = null;
    }
  }

  /**
   * Something is being laid on the sheet in document units — a line, a
   * handle, the mega eraser's sweep, a tool's own drag, the Shift size. The
   * view must hold still meanwhile: the same spot of the screen would become
   * another spot of the sheet, and the line would jump straight across it.
   * A pan is not in it: it moves the view and lays nothing down.
   */
  function drawingBusy(): boolean {
    return pointer.session !== null || grab !== null || megaGesture !== null || pluginGrab !== null
      || sizing !== null;
  }

  /** The pen (or mouse) is in the middle of something on the sheet. */
  function penBusy(): boolean {
    return pointer.session !== null || grab !== null || gesturePointerId !== -1 || sizing !== null
      || (panning !== null && !touches.has(panning.pointerId));
  }

  /** A palm resting by the working pen: not a gesture, and not the cursor either. */
  function isPalm(e: PointerEvent): boolean {
    return e.pointerType === 'touch' && editor.penSeen && penBusy();
  }

  /** A finger pinching or panning the sheet, not drawing on it. */
  function movesView(e: PointerEvent): boolean {
    return e.pointerType === 'touch'
      && ((gesture !== null && touches.has(e.pointerId)) || panning?.pointerId === e.pointerId);
  }

  /** The side buttons draw here, but their release must not page the browser back (side-buttons.ts). */
  const sideButtons = createSideButtonGuard();
  // A side button pressed on the sheet is let go wherever the hand is by then:
  // the window hears it first, before the browser turns it into «back».
  $effect(() => {
    const kinds = ['pointerup', 'mouseup', 'auxclick'] as const;
    for (const kind of kinds) window.addEventListener(kind, sideButtons.release, { capture: true });
    return () => {
      for (const kind of kinds) window.removeEventListener(kind, sideButtons.release, { capture: true });
    };
  });

  function onPointerDown(e: PointerEvent): void {
    sideButtons.press(e.button);
    followPenEnd(e);
    // The first finger on the sheet brings the thickness rail.
    if (e.pointerType === 'touch') {
      touchSeen = true;
    }
    if (e.pointerType === 'pen') {
      editor.penSeen = true;
      // The palm landed first and started a stroke: it goes, unrecorded, and
      // the pen draws.
      if (pointer.session && touches.has(pointer.session.pointerId) && pointer.discard()) {
        strokeLayer = undefined;
        scheduleDraw();
      }
      if (touches.has(gesturePointerId)) {
        dropOwnGesture();
        scheduleDraw();
      }
      // The palm touched down while the pen still hovered and is moving the
      // sheet: it stops, or the line smears across a sliding page.
      stopTouchNavigation();
    }
    // Any other pointer landing ends the hold and the pipette it brought:
    // a second finger is the pinch, a pen draws.
    cancelHold();
    dropper = null;
    // Touch and hold brings the pipette (Procreate Dreams). The timer runs
    // alongside whatever the press starts below; startDropper undoes it.
    if (mayHoldPick({
      pointerType: e.pointerType,
      isPrimary: e.isPrimary,
      fingers: touches.size,
      playing: editor.playing,
      transform: editor.transform !== null,
      tool: editor.tool,
      ownGesture: !!toolSpec(editor.tool)?.press,
      onSheet: e.pointerType === 'touch' && !offSheet(e),
      penBusy: editor.penSeen && penBusy(),
    })) {
      hold = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, timer: setTimeout(startDropper, HOLD_PICK_MS) as unknown as number };
    }
    if (startNavigation(e)) {
      // The finger brought the ring with it (pointerenter) and it stood under
      // it until the first move: fingers moving the sheet carry no brush.
      if (movesView(e)) {
        cursorVisible = false;
      }
      e.preventDefault();
      return;
    }
    if (editor.playing || !e.isPrimary || pointer.session) {
      return;
    }
    // Shift+drag sizes the brush wherever its ring is the cursor (Krita; the
    // owner: settings are a gesture in the editor). The mouse button or the
    // pen tip; a finger never, it has no Shift. No dot, no stroke.
    if (e.shiftKey && e.button === 0 && e.pointerType !== 'touch' && !editor.transform
      && editor.tool !== 'pipette' && !overlayCursor) {
      const size = editor.brushSizeLogical;
      sizing = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, start: size, size };
      canvasEl.setPointerCapture(e.pointerId);
      return;
    }
    // A live transform owns the canvas: a handle scales, the ring outside a
    // corner turns, the body moves. It comes before every drawing tool.
    if (editor.transform) {
      const [x, y] = toDocUnits(e);
      const mode = hitMode(x, y, editor.transform.box, editor.transform.session, hitScale(e));
      hoverMode = mode;
      if (mode !== 'none') {
        grab = { pointerId: e.pointerId, mode, base: editor.transform.session, x, y, axis: null, moved: false };
        canvasEl.setPointerCapture(e.pointerId);
        return;
      }
    }
    // The lasso is not a drawing tool, so a press never leaves a stroke. With
    // no session open it takes the frame again: applying or cancelling would
    // otherwise strand the tool in hand with nothing left to edit.
    if (editor.tool === 'lasso') {
      if (!editor.transform) {
        editor.beginTransform();
      }
      return;
    }
    // A tool that brought its own gesture runs it; the canvas knows only that
    // there are callbacks, not which tool it is.
    const spec = toolSpec(editor.tool);
    if (spec?.press) {
      if (!editor.beginPluginGesture()) {
        return;
      }
      const [x, y] = toDocUnits(e);
      // A press that throws closes the gesture it opened: left open, the
      // next one joined it and its writes never became a step of undo.
      try {
        spec.press(editor.pluginHost(), { x, y });
      } catch (err) {
        editor.endPluginGesture();
        throw err;
      }
      // Pinned: a hotkey mid-drag changes the tool in hand, not this gesture.
      pluginGrab = { pointerId: e.pointerId, spec };
      canvasEl.setPointerCapture(e.pointerId);
      gesturePointerId = e.pointerId;
      return;
    }
    if (editor.tool === 'pipette') {
      // The table beside the sheet holds no colour and no emptiness to erase:
      // a press that missed the sheet takes nothing, and the tool stays.
      if (offSheet(e)) {
        return;
      }
      // Right button takes the fill color (reference: ЛКМ — контур, ПКМ — заливка);
      // the palette's pipette can arm the fill for the left button too.
      const toFill = e.button === 2 || editor.pipetteTarget === 'fill';
      if (takeColour(e, toFill) !== null && !toFill) {
        // Back to whatever was drawing — the pen stays a pen (ResetHelpTool).
        editor.resetHelpTool();
      }
      return;
    }
    if (editor.tool === 'mega-eraser') {
      if (!editor.mayEdit()) {
        return;
      }
      const [x, y] = toDocUnits(e);
      megaGesture = [Math.round(x), Math.round(y)];
      megaAt = { layer: editor.doc.layers[editor.activeLayer], cell: editor.activeCell };
      canvasEl.setPointerCapture(e.pointerId);
      gesturePointerId = e.pointerId;
      scheduleDraw();
      return;
    }
    // Nothing would appear — the state says so instead of swallowing the gesture.
    if (!editor.mayEdit()) {
      return;
    }
    strokeLayer = editor.doc.layers[editor.activeLayer];
    strokeCell = editor.activeCell;
    // The eraser end (5) is the eraser itself, not a second button's colour.
    strokeButton = e.button === 5 ? 0 : e.button;
    canvasEl.setPointerCapture(e.pointerId);
    pointer.pointerDown(toPointerSample(e, true));
    scheduleDraw();
  }

  function onPointerMove(e: PointerEvent): void {
    // A second button pressed while the first is held comes as a move, not a
    // pointerdown: a thumb on «back» in the middle of a line left the studio.
    sideButtons.press(e.button);
    // A mouse or a pen moving with no button held has let go somewhere the
    // canvas did not hear (a native dialog, the window losing focus): end the
    // gesture here, or the stroke follows the hover and refuses the next press.
    // A finger has no hover — its moves are always pressed.
    if (e.pointerType !== 'touch' && e.buttons === 0
      && (pointer.session || grab || megaGesture || pluginGrab || panning || sizing)) {
      onPointerUp(e);
      return;
    }
    if (dropper && e.pointerId === dropper.pointerId) {
      const now = performance.now();
      if (now - lastPickPreview >= PIPETTE_THROTTLE_MS) {
        lastPickPreview = now;
        aimDropper(e);
      } else {
        dropper = { ...dropper, x: e.clientX, y: e.clientY };
      }
      return;
    }
    // A finger that travels has begun a line or a pan: it stays that.
    if (hold && e.pointerId === hold.pointerId && !stillHeld(hold, { x: e.clientX, y: e.clientY })) {
      cancelHold();
    }
    if (sizing && e.pointerId === sizing.pointerId) {
      sizing.size = sizeFromDrag(sizing.start, e.clientX - sizing.x, e.clientY - sizing.y,
        editor.brushRange.min, editor.brushSizeMax);
      return;
    }
    // Read once here and handed to every branch below, so a move costs one query.
    const rect = canvasRect();
    // The ring stays under the nib: a palm sliding by it took it at every move.
    if (!isPalm(e)) {
      // Whatever moves over the canvas is on it. A finger lifting put the ring
      // out (pointerleave), and the mouse or the pen that had been there all
      // along gets no new pointerenter: under `cursor: none` there was no
      // cursor at all until it left the canvas and came back.
      // Fingers moving the sheet carry no brush: the ring jumped between the
      // two of a pinch (owner, after the eighteenth audit).
      if (movesView(e)) {
        cursorVisible = false;
      } else {
        cursorVisible = true;
        cursorX = e.clientX;
        cursorY = e.clientY;
      }
      // Where the zoom buttons, the slider and `+`/`-` will zoom around.
      editor.lastScalePivot = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    if (panning && e.pointerId === panning.pointerId) {
      panBy(e.clientX - panning.x, e.clientY - panning.y);
      panning = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    if (megaGesture && e.pointerId === gesturePointerId) {
      const [x, y] = toDocUnits(e, rect);
      megaGesture.push(Math.round(x), Math.round(y));
      scheduleDraw();
      return;
    }
    if (pluginGrab && e.pointerId === gesturePointerId) {
      // ponytail: the tool throttles its own writes (distort does it every
      // fifth reference pixel). Batch by rAF if a big frame ever stutters.
      const [x, y] = toDocUnits(e, rect);
      pluginGrab.spec.move?.(editor.pluginHost(), { x, y });
      return;
    }
    if (grab && e.pointerId === grab.pointerId) {
      dragTransform(e, rect);
      return;
    }
    // No button down over an open transform: the cursor names the zone.
    if (editor.transform) {
      const [x, y] = toDocUnits(e, rect);
      hoverMode = hitMode(x, y, editor.transform.box, editor.transform.session, hitZoom);
    }
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gesture && touches.size === 2) {
        const next = pinchFrom(touches);
        zoomTo(gesture.zoom * (next.distance / gesture.distance), next.midX, next.midY);
        panBy(next.midX - gesture.midX, next.midY - gesture.midY);
        // What the view took, clamp and all: past 10× the fingers coming back
        // together answer at once instead of unwinding a zoom nobody sees.
        gesture = { ...next, zoom: editor.view.zoom };
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
        pickPreview = pickColor(e) ?? null;
      }
    }
    if (!pointer.session || !e.isPrimary) {
      return;
    }
    // Multator keeps one point per event; Tonio unpacks its coalesced batch.
    pointer.pointerMove(toPointerSample(e, true));
    scheduleDraw();
  }

  /** Whether the hand is moving the sheet right now — a pan or two fingers. */
  function navigating(): boolean {
    return panning !== null || gesture !== null;
  }

  /** Fingers let go of the sheet at once. */
  function stopTouchNavigation(): void {
    if (!gesture && !(panning && touches.has(panning.pointerId))) {
      return;
    }
    gesture = null;
    panning = null;
    scheduleDraw(false);
  }

  function endNavigation(e: PointerEvent): boolean {
    const was = navigating();
    touches.delete(e.pointerId);
    // A third finger lifted: the pinch goes on with the two left, measured
    // afresh — against the old pair the view leapt.
    if (gesture && touches.size === 2) {
      gesture = pinchFrom(touches);
    }
    if (touches.size < 2) {
      // The finger left after a pinch goes on panning without lifting — only
      // where a finger navigates; under a drawing tool it never draws.
      if (gesture && touches.size === 1 && (editor.tool === 'drag' || editor.penSeen)) {
        const [[pointerId, at]] = touches;
        panning = { pointerId, x: at.x, y: at.y };
      }
      gesture = null;
    }
    if (panning && e.pointerId === panning.pointerId) {
      panning = null;
    }
    // The lift that ends a gesture ends nothing else.
    return was && !navigating();
  }

  function onPointerUp(e: PointerEvent): void {
    // Once whatever this ends has let go of the sheet.
    queueMicrotask(settleCovers);
    if (hold?.pointerId === e.pointerId) {
      cancelHold();
    }
    if (endNavigation(e)) {
      return;
    }
    if (dropper && e.pointerId === dropper.pointerId) {
      finishDropper(e);
      return;
    }
    if (sizing && e.pointerId === sizing.pointerId) {
      // Through the slider's own setter: clamped, saved to the brush record.
      editor.brushSizeLogical = sizing.size;
      sizing = null;
      return;
    }
    if (grab && e.pointerId === grab.pointerId) {
      grab = null;
      return;
    }
    if (pluginGrab && e.pointerId === gesturePointerId) {
      releasePluginGrab();
      return;
    }
    if (megaGesture && e.pointerId === gesturePointerId) {
      const layer = megaAt.layer ? editor.doc.layers.indexOf(megaAt.layer) : -1;
      const frame = megaAt.cell ? editor.doc.layers[layer]?.frames.indexOf(megaAt.cell) ?? -1 : -1;
      editor.applyMegaEraser(megaGesture, brushWidthDoc(editor.brushSizeLogical) / 2, layer, frame);
      megaGesture = null;
      gesturePointerId = -1;
      composer.invalidate();
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

  /**
   * One pointermove inside a live transform. Every step is measured from the
   * session the press started on, not from the last move, so shift can lock
   * an axis and ctrl can snap an angle without the drag drifting.
   */
  function dragTransform(e: PointerEvent, rect: DOMRect): void {
    const open = editor.transform;
    if (!open || !grab) {
      return;
    }
    const [x, y] = toDocUnits(e, rect);
    const start = { x: grab.x, y: grab.y };
    const pos = { x, y };
    let next: TransformSession;
    if (grab.mode === 'move') {
      const moved = movedBy(grab.base, start, pos, e.shiftKey, grab.axis);
      grab.axis = moved.axis;
      next = moved.session;
    } else if (grab.mode === 'rotate') {
      next = rotatedTo(grab.base, open.box, start, pos, e.ctrlKey || e.metaKey);
    } else {
      next = scaledBy(grab.base, open.box, grab.mode, start, pos, e.shiftKey);
    }
    // The first move that changes the session files the step, the rest of the
    // drag replaces it. A move that changed nothing (a pen's pressure alone)
    // has not begun it: counted, the next one replaced the step before the drag.
    grab.moved = editor.setTransform(next, grab.moved) || grab.moved;
  }

  function commitPendingStroke(): void {
    const stroke = pointer.takeCommitted();
    if (!stroke) return;
    // The pinned layer may have been removed mid-gesture; then it has no index
    // any more and the stroke has nowhere to land.
    const index = strokeLayer ? editor.doc.layers.indexOf(strokeLayer) : -1;
    // The cell is found again the same way: a frame put in front of it
    // mid-line moved its index, not the cell.
    const frame = strokeCell ? editor.doc.layers[index]?.frames.indexOf(strokeCell) ?? -1 : -1;
    if (index < 0 || frame < 0) return;
    try {
      editor.commitStroke(index, stroke, frame);
    } catch (err) {
      // The limits are the state's to refuse (commitStroke); what reaches here
      // is a fault. The input handler survives it, and the error log hears of
      // it — the console alone kept it from the report a user sends.
      reportError(err);
    }
  }

  function onPointerCancel(e: PointerEvent): void {
    queueMicrotask(settleCovers);
    // Also the lost capture every gesture ends with: the keys come back once
    // no other pointer still holds one.
    heldPointers.delete(e.pointerId);
    editor.gestureHeld = heldPointers.size > 0;
    // A cancelled finger takes nothing.
    if (hold?.pointerId === e.pointerId) {
      cancelHold();
    }
    if (dropper?.pointerId === e.pointerId) {
      dropper = null;
    }
    if (endNavigation(e)) {
      return;
    }
    // The size goes back to what it was: nothing was written yet.
    if (sizing && e.pointerId === sizing.pointerId) {
      sizing = null;
      return;
    }
    // A cancelled pointer must not leave a half-drawn polygon or a held
    // handle behind: both would keep reacting to the next move.
    if (grab && e.pointerId === grab.pointerId) {
      grab = null;
      return;
    }
    if (e.pointerId === gesturePointerId) {
      dropOwnGesture();
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
    const rect = canvasRect();
    const [x, y] = toDocUnits(e, rect);
    // Only a pen knows how hard it is pressed: a mouse reports a constant, and
    // a finger whatever its screen guesses.
    const pressed = e.pointerType === 'pen' && editor.settings.penPressure;
    // «Режим мышки» is the reference `oldPen`: one point per event, no
    // coalesced batch. What a brush does with the samples a browser held back
    // is its own rule — one takes them all, one keeps only the event itself —
    // so the canvas hands them over and does not choose for it.
    const coalesced = unpackCoalesced
      && !editor.settings.mouseMode
      ? e.getCoalescedEvents?.().map((sample) => {
          const [sampleX, sampleY] = toDocUnits(sample, rect);
          return {
            pointerId: sample.pointerId, isPrimary: sample.isPrimary, x: sampleX, y: sampleY,
            pressure: pressed ? sample.pressure : undefined,
          };
        })
      : undefined;
    return { pointerId: e.pointerId, isPrimary: e.isPrimary, x, y, coalesced, pressure: pressed ? e.pressure : undefined };
  }
</script>

<!-- The wheel on the whole stage: over the thickness rail, Ctrl+wheel zoomed
     the page instead of the sheet. -->
<div
  class="wrap"
  bind:this={wrapEl}
  bind:clientWidth={wrapWidth}
  bind:clientHeight={wrapHeight}
  onwheel={onWheel}
>
  <!-- ARIA in HTML allows any role on <canvas>; `img` is the honest one for a
       surface that renders a picture, and without it the drawing is an
       anonymous box in the accessibility tree. -->
  <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
  <!-- The right button picks the fill colour and draws with it, so the
       browser menu never opens over the canvas. -->
  <canvas
    bind:this={canvasEl}
    role="img"
    aria-label={canvasLabel}
    style:width="{stage.width}px"
    style:height="{stage.height}px"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    oncontextmenu={(e) => e.preventDefault()}
    onpointerup={onPointerUp}
    onpointercancel={onPointerCancel}
    ongotpointercapture={(e) => {
      heldPointers.add(e.pointerId);
      editor.gestureHeld = true;
    }}
    onlostpointercapture={onPointerCancel}
    onpointerenter={(event) => {
      if (isPalm(event)) return;
      cursorVisible = true;
      cursorX = event.clientX;
      cursorY = event.clientY;
    }}
    onpointerleave={(event) => {
      // A palm lifting by the pen takes neither the ring nor the pivot.
      if (isPalm(event)) return;
      cursorVisible = false;
      pickPreview = null;
      // Off the canvas the zoom keys zoom around the middle of the view, not
      // the edge the cursor left by (owner, after the sixteenth audit).
      editor.lastScalePivot = null;
    }}
    class:custom-cursor={!editor.playing && editor.tool !== 'pipette' && !overlayCursor}
    class:playing={editor.playing}
    style:cursor={(!editor.playing && overlayCursor) || null}
  ></canvas>
  <!-- Selection chrome. Purely visual: every gesture is read off the canvas
       itself, so pointer capture, touch and the keyboard path stay intact. -->
  {#if displayedHandles}
    <svg
      class="overlay"
      width={stage.width}
      height={stage.height}
      viewBox="0 0 {stage.width} {stage.height}"
      aria-hidden="true"
    >
      <!-- The side midpoints sit on the sides, so all eight points trace the
           same outline as the four corners alone. -->
      <polygon class="frame" points={screenPoints(displayedHandles)} />
      {#each [0, 1, 2, 3, 4, 5, 6, 7] as handle (handle)}
        {@const [hx, hy] = toScreen(displayedHandles[handle * 2], displayedHandles[handle * 2 + 1])}
        <rect class="handle" x={hx - 5} y={hy - 5} width="10" height="10" />
      {/each}
    </svg>
  {/if}
  <!-- Always in the tree: a live region mounted with its words is not
       announced by most screen readers; one that is there already is. -->
  <p class="hint" class:shown={hint} role="status" aria-live="polite">{hint}</p>
  {#if cursorVisible && !editor.playing && editor.tool === 'pipette' && pickPreview}
    <span
      class="pick-preview"
      style:transform="translate({cursorX}px, {cursorY}px)"
      style:background={pickPreview}
      aria-hidden="true"
    ></span>
  {/if}
  {#if dropper}
    <!-- Dreams' loupe: the colour the finger would take on top, the outline
         now below; lifted over the finger that would hide it. -->
    <span
      class="loupe"
      class:below={dropper.y < 140}
      style:transform="translate({loupeX(dropper.x)}px, {dropper.y}px)"
      aria-hidden="true"
    >
      <span
        class="loupe-new"
        class:empty={!dropper.off && dropper.color === null}
        style:background={dropper.off ? editor.brushColor : dropper.color}
      ></span>
      <span style:background={editor.brushColor}></span>
    </span>
  {/if}
  {#if ring}
    <!-- Where the drag began (the rail: the middle of the stage), at the size
         it has reached, in the sheet's real scale — the number beside it for
         a size too big or too thin to read. -->
    <span
      class="brush-cursor size-ring"
      class:square={toolSpec(editor.brushTool)?.stroke?.grid}
      style:transform="translate({ring.x}px, {ring.y}px) translate(-50%, -50%)"
      style:width="{diameterOf(ring.size)}px"
      style:height="{diameterOf(ring.size)}px"
      aria-hidden="true"
    ></span>
    <span
      class="size-number"
      style:transform="translate({ring.x}px, {ring.y}px) translate(-50%, calc(-100% - 12px))"
      aria-hidden="true"
    >{t('brush.size_title', { size: ring.size })}</span>
  {/if}
  <!-- The thickness for a finger (Procreate Dreams' sidebar): on the stage,
       not in a column, so it stays whatever the panels around it do. Through
       the preview it stays as the fps slider does, aria-disabled: gone, it
       dropped the focus on it to <body> (owner, after the seventeenth audit). -->
  <div
    class="size-rail"
    data-over-sheet
    class:touched={touchSeen}
    role="slider"
    tabindex="0"
    aria-orientation="vertical"
    aria-label={t('brush.sizes_group')}
    aria-valuemin={editor.brushRange.min}
    aria-valuemax={editor.brushSizeMax}
    aria-valuenow={editor.brushSizeLogical}
    aria-valuetext={t('brush.size_value', { count: editor.brushSizeLogical })}
    aria-disabled={editor.playing || undefined}
    onpointerdown={onRailDown}
    onpointermove={onRailMove}
    onpointerup={onRailUp}
    onpointercancel={onRailUp}
    onlostpointercapture={onRailUp}
    onkeydown={onRailKey}
    onkeyup={() => { if (railHeld?.pointerId === -1) railHeld = null; }}
    onblur={() => (railHeld = null)}
  >
    <span class="rail-track" bind:this={railTrack}>
      <span
        class="rail-knob"
        style:bottom="{(positionOfSize(editor.brushSizeLogical, editor.brushRange.min, editor.brushSizeMax) / SIZE_TRACK) * 100}%"
      ></span>
    </span>
  </div>
  {#if cursorVisible && !editor.playing && editor.tool !== 'pipette' && !overlayCursor && !ring && !dropper}
    <span
      class="brush-cursor"
      class:eraser={editor.tool === 'eraser' || editor.tool === 'mega-eraser'}
      class:cross={cursorParts.cross}
      class:ringless={!cursorParts.ring}
      class:square={toolSpec(editor.brushTool)?.stroke?.grid}
      style:transform="translate({cursorX}px, {cursorY}px) translate(-50%, -50%)"
      style:width="{cursorDiameter}px"
      style:height="{cursorDiameter}px"
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
    /* A finger held still is the pipette (hold-pick.ts): iOS took the same
       hold for a text selection and its callout. */
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }
  canvas {
    display: block;
    /* The worktable itself: the sheet, its edge and its shadow are painted
       into the canvas, wherever the view has put it. */
    background: transparent;
    /* Page scroll/zoom must not hijack drawing. */
    touch-action: none;
    cursor: crosshair;
  }
  canvas.custom-cursor {
    cursor: none;
  }
  /* Through the preview a press does nothing: no ring, no swatch, no cross
     promising otherwise — the system's own arrow. */
  canvas.playing {
    cursor: default;
  }
  .overlay {
    position: absolute;
    /* The canvas fills the wrap; the overlay sits exactly on it. */
    left: 0;
    top: 0;
    pointer-events: none;
  }
  .overlay .frame {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1;
    stroke-dasharray: 5 3;
  }
  .overlay .handle {
    fill: var(--canvas);
    stroke: var(--accent);
    stroke-width: 2;
  }
  /* Pinned to the corner and carried by the transform on the element: moving
     `left`/`top` was a layout per pointermove. */
  .brush-cursor {
    position: fixed;
    left: 0;
    top: 0;
    z-index: var(--z-cursor);
    border: 1px solid var(--ink);
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--canvas);
    pointer-events: none;
    /* The drawing under it is never recoloured, so neither is the ring that
       has to show on it: forced colors would drop the halo. */
    forced-color-adjust: none;
  }
  .brush-cursor.eraser {
    border-style: dashed;
  }
  /* Too thin for a circle: the crosshair is the whole cursor. */
  .brush-cursor.ringless {
    border-color: transparent;
    box-shadow: none;
  }
  /* The pixel tool paints grid cells, so its cursor is one cell. */
  .brush-cursor.square {
    border-radius: 0;
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
  /* The number of the Shift+drag, over the ring, as the hint is drawn. */
  .size-number {
    position: fixed;
    left: 0;
    top: 0;
    z-index: var(--z-cursor);
    padding: 2px 8px;
    border-radius: var(--r-pill);
    background: var(--ink);
    color: var(--canvas);
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    pointer-events: none;
  }
  /* The finger's thickness rail: a flat key-wide plate on the stage's left
     edge, where Dreams keeps its sidebar, out of a right hand's way. Hidden
     for a mouse; a coarse pointer or the first finger brings it. */
  .size-rail {
    position: absolute;
    /* Clear of the side column's fold tab on the stage's edge. The safe
       area is the editor's (its inline padding): counted here as well, the
       rail stood twice as far in behind a notch. */
    left: 1.25rem;
    /* Up to 16rem in the middle of the stage; a short landscape stage keeps
       its foot clear of the zoom bar in the corner below (4.5rem). */
    top: max(0.75rem, 50% - 8rem);
    bottom: max(4.5rem, 50% - 8rem);
    display: none;
    /* A finger wide, not a key: grown with the text it took 88 px of a
       240 px phone stage at 200 % (owner, after the sixteenth audit). */
    width: var(--tap, 44px);
    box-sizing: border-box;
    border: 1px solid var(--edge);
    border-radius: var(--r-pill);
    background: var(--canvas);
    touch-action: none;
    cursor: pointer;
  }
  .size-rail.touched {
    display: block;
  }
  @media (pointer: coarse) {
    .size-rail {
      display: block;
    }
  }
  .size-rail:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  /* The preview: kept, and in the Tab order, as the fps slider is. */
  .size-rail[aria-disabled='true'] {
    opacity: 0.45;
    cursor: default;
  }
  /* The track and knob of the editor's range (controls.css), stood upright;
     the track is inset by half a knob so the ends are reachable. */
  .rail-track {
    position: absolute;
    left: 50%;
    top: 14px;
    bottom: 14px;
    width: 6px;
    transform: translateX(-50%);
    border-radius: var(--r-pill);
    background: var(--sub);
  }
  .rail-knob {
    position: absolute;
    left: 50%;
    width: 20px;
    height: 20px;
    box-sizing: border-box;
    transform: translate(-50%, 50%);
    border: 3px solid var(--canvas);
    border-radius: var(--r-pill);
    background: var(--accent);
    box-shadow: 0 0 0 1px var(--edge);
  }
  @media (forced-colors: active) {
    .size-rail {
      forced-color-adjust: none;
      border-color: CanvasText;
      background: Canvas;
    }
    .rail-track {
      background: CanvasText;
    }
    .rail-knob {
      border-color: Canvas;
      background: Highlight;
      box-shadow: 0 0 0 1px CanvasText;
    }
    .size-rail:focus-visible {
      outline-color: Highlight;
    }
  }
  /* Tonio draws a 25px swatch down-right of the pipette cursor. */
  .pick-preview {
    position: fixed;
    left: 0;
    top: 0;
    z-index: var(--z-cursor);
    width: 25px;
    height: 25px;
    margin: 10px 0 0 10px;
    border: 1px solid var(--ink);
    box-shadow: 0 0 0 1px var(--canvas);
    pointer-events: none;
    /* The colour is the drawing's: forced colors painted it the system Canvas. */
    forced-color-adjust: none;
  }
  /* The held finger's loupe: a flat disc, the new colour over the current. */
  .loupe {
    position: fixed;
    left: 0;
    top: 0;
    z-index: var(--z-cursor);
    display: flex;
    flex-direction: column;
    width: 72px;
    height: 72px;
    margin: -124px 0 0 -36px;
    box-sizing: border-box;
    overflow: hidden;
    border: 3px solid var(--canvas);
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--ink);
    pointer-events: none;
    /* The colours are the drawing's, not the theme's. */
    forced-color-adjust: none;
  }
  .loupe.below {
    margin-top: 52px;
  }
  .loupe > span {
    flex: 1;
  }
  /* Emptiness is the eraser: the loupe shows no colour there. */
  .loupe-new.empty {
    background: repeating-linear-gradient(45deg, var(--canvas) 0 6px, var(--sub) 6px 12px);
  }
  @media (prefers-reduced-motion: no-preference) {
    .loupe {
      animation: loupe-in 120ms ease-out;
    }
  }
  @keyframes loupe-in {
    from {
      opacity: 0;
    }
  }
  @media (forced-colors: active) {
    .loupe {
      border-color: Canvas;
      box-shadow: 0 0 0 1px CanvasText;
    }
  }
  .hint {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    /* Its own width up to the stage's: a box starting at the middle is
       otherwise given half the stage and wraps a sentence word by word. */
    width: max-content;
    max-width: calc(100% - 24px);
    /* «трансформировать» at 200 % text is wider than a phone's whole pill:
       it hung out of both sides, cut by the stage. */
    overflow-wrap: anywhere;
    /* Over the thickness rail, which stands lower than a tall pill's top and
       is drawn after it; the finger still goes through. */
    z-index: 1;
    box-sizing: border-box;
    text-align: center;
    margin: 0;
    padding: 6px 12px;
    /* A pill on one line; on six, a full pill's corners cut the first and
       the last line's ends. */
    border-radius: var(--r-xl);
    background: var(--ink);
    color: var(--canvas);
    font-size: 0.8125rem;
    pointer-events: none;
  }
  /* Empty, it stays in the tree for the reader and draws nothing: `display:
     none` would take the live region away with it. */
  .hint:not(.shown) {
    padding: 0;
    background: none;
  }
</style>
