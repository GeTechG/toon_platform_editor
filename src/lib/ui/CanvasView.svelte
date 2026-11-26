<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { toolSpec } from './panels';
  import { pastDragThreshold } from './draggable';
  import { dismissedOnly } from './dismiss-press';
  import { PENCIL } from '../plugins';
  import type { EditorState, Tool } from './editor-state.svelte';
  import { BACKGROUND_COLOR, CANVAS_LOGICAL_WIDTH, FIXED_POINT_SCALE, ONION_BLEND_ALPHA } from '../format/constants';
  import type { Cell, Frame, Layer } from '../format/types';
  import { resolveCell } from '../model/cells';
  import { stillStart } from '../model/stills';
  import { frameCount, placeStrokePoints, scaleToolWidth } from '../model/operations';
  import type { Viewport } from '../render/contract';
  import {
    renderRawPolyline,
    renderResolvedPreview,
    renderLayersStacked,
    renderStrokesLayer,
    STUDIO_PATHS,
    type BlitTarget,
    type Canvas2DLike,
  } from '../render/canvas2d';
  import { CELL_CACHE_BYTES, type FrameScene, type LiveLine } from '../render/frame-compose';
  import {
    Canvas2DSheetComposer,
    type DeclarativeLiveStroke,
    type SheetComposer,
    type StagePresentParams,
  } from '../render/sheet-composer';
  import {
    acquireStudioWebGL2,
    MIN_WEBGL2_DIMENSION,
    validateWebGL2Candidate,
    type AtlasFormats,
    type RenderBackendReason,
  } from '../render/webgl/probe';
  import { WebGL2SheetComposer } from '../render/webgl/composer';
  import { studioVramBudget } from '../render/webgl/vram-budget';
  import { PlaybackFrames, playbackKeeps } from './playback-frames';
  import { playbackWindow } from '../render/playback-window';
  import { CellWarmer } from '../render/cell-warm';
  import { cellCrew } from '../render/cell-crew';
  import { studioCells } from '../render/studio-cells';
  import { isFlatPaint, isFilledLineTool } from '../render/dispatch';
  import { cursorShape, pickSource } from './frame-selection';
  import {
    hitMode,
    movedBy,
    rotatedTo,
    scaledBy,
    EMPTY_TRANSFORM,
    sameSession,
    keepsShape,
    sessionMatrix,
    sessionWidthScale,
    type HitMode,
    type TransformSession,
  } from '../tools/lasso';
  import {
    clipCover,
    clampPan,
    footOf,
    fitSheet,
    fitView,
    sheetRaster,
    type SheetRaster,
    renderDensity,
    reprojection,
    shotCovers,
    resizedView,
    type DrawnView,
    toDocument,
    toWorkspace,
    zoomAt,
    rotateAt,
    snapAngle,
    wrapAngle,
    TWIST_SLOP,
    ctrlWheelZoom,
    WHEEL_SOFT_RATE,
    WHEEL_ZOOM_RATE,
    easeZoom,
    ZOOM_MAX,
    ZOOM_MIN,
    trackpadScroll,
    type Cover,
    type Stage,
  } from './viewport';
  import { brushWidthDoc } from '../tools/stroke-builder';
  import { shapeStroke } from '../tools/shapes';
  import { alongRuler, hitRuler, movedRuler, rulerAcross, turnedRuler, RULER_THICKNESS_PX, type Ruler, type RulerHit } from '../tools/ruler';
  import { colourDistance, distanceField, fillRegion, growRim, keyhole, lowestSeenSlot, oldFillsIn, pureOf, recolouredFill, smoothRing, traceRings } from '../tools/fill';
  import { applyMatrix, clampCoord } from '../model/geom';
  import { SIZE_TRACK, positionOfSize, sizeAtRail, sizeByKey, sizeFromDrag } from './size-scale';
  import { opacityOf, type LineToolDescriptor } from '../format/types';
  import {
    PointerStrokeController,
    swapStrokeColours,
    previewStrokeSession,
    previewStrokePressure,
    drawsPressure,
    withOpacity,
    type PointerSample,
  } from '../tools/profiles';
  import type { StrokeRules } from '../plugins/contract';
  import { t } from '../i18n';
  import { HOLD_PICK_MS, colourOfPixel, mayHoldPick, stillHeld } from './hold-pick';
  import { nextHint } from './canvas-hint';
  import { createSideButtonGuard } from './side-buttons';

  /** `rail`: the stage's own thickness rail — off where a panel already holds the slider (panels.ts). */
  let { editor, rail = true }: { editor: EditorState; rail?: boolean } = $props();

  // The visible context needs a few more members than the pure Canvas2DLike/
  // BlitTarget seam (alpha compositing, clearing). It is a real 2D context.
  type ViewCtx = Canvas2DLike &
    BlitTarget & {
      globalAlpha: number;
      imageSmoothingEnabled: boolean;
      imageSmoothingQuality: string;
      clearRect(x: number, y: number, w: number, h: number): void;
      rect(x: number, y: number, w: number, h: number): void;
      clip(): void;
      save(): void;
      restore(): void;
      getImageData(x: number, y: number, w: number, h: number): ImageData;
      putImageData(data: ImageData, x: number, y: number): void;
    };

  let captureStageEl: HTMLDivElement;
  let canvasEl: HTMLCanvasElement;
  let glCanvasEl = $state<HTMLCanvasElement | undefined>();
  /** True only once the live WebGL2 context has successfully rendered the current scene. */
  let webglVisible = $state(false);
  /** Bumped only when manually re-enabling hardwareRender so a fresh canvas is created. */
  let glMountKey = $state(0);
  let glContext: WebGL2RenderingContext | null = null;
  let glComposer: WebGL2SheetComposer | null = null;
  let glFormats: AtlasFormats | null = null;
  /** Cached MAX_TEXTURE_SIZE read once on acquire/restore to avoid per-frame sync WebGL IPC. */
  let glMaxTextureSize = 0;
  let glProbed = false;
  let glSoftwareBrowser = false;
  let glContextLost = false;
  let glRestorePending = false;
  let glIntentionalLose = false;
  let glLossTimes: number[] = [];
  let glSessionRetired: RenderBackendReason | null = null;
  /** Monotonic token discarding async warm/bitmap callbacks from a retired backend. */
  let backendGeneration = 0;

  function capturePointer(pointerId: number): void {
    (captureStageEl ?? canvasEl).setPointerCapture(pointerId);
  }

  function retireWebGL(reason: RenderBackendReason, loseContext = true): void {
    backendGeneration += 1;
    webglVisible = false;
    navShot = null;
    lastDrawn = null;
    glComposer?.dispose();
    glComposer = null;
    if (loseContext && glContext) {
      const doomed = glContext;
      glContext = null;
      glFormats = null;
      glMaxTextureSize = 0;
      glIntentionalLose = true;
      try {
        doomed.getExtension('WEBGL_lose_context')?.loseContext();
      } catch {
        // Context already lost.
      } finally {
        queueMicrotask(() => { glIntentionalLose = false; });
      }
    }
    if (reason === 'oom' || reason === 'context-lost') {
      glSessionRetired = reason;
    }
    editor.renderBackend = {
      active: 'canvas2d',
      reason,
      isSoftwareBrowser: reason === 'software-browser' || glSoftwareBrowser,
    };
  }

  /**
   * Unified recoverable WebGL2 context-loss handler shared by synchronous `draw()`
   * detection and the asynchronous DOM `webglcontextlost` event so the first loss
   * always allows restoration and is never double-counted.
   */
  function handleRecoverableContextLoss(): void {
    if (glSessionRetired) return;
    backendGeneration += 1;
    webglVisible = false;
    navShot = null;
    lastDrawn = null;
    glComposer?.dispose();
    glComposer = null;
    glRestorePending = false;
    if (!glContextLost) {
      glContextLost = true;
      const now = Date.now();
      glLossTimes = glLossTimes.filter((t) => now - t < 60_000);
      glLossTimes.push(now);
      if (glLossTimes.length >= 2) {
        retireWebGL('context-lost', true);
        return;
      }
    }
    editor.renderBackend = { active: 'canvas2d', reason: 'context-lost', isSoftwareBrowser: false };
  }
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
  let sizing = $state<{ pointerId: number; x: number; y: number; start: number; size: number; magnet: boolean } | null>(null);
  /** The magnet in hand: the ring is its circle of influence, and Shift+drag sizes that. */
  const magnet = $derived(editor.tool === 'magnet');

  /**
   * The finger's way to the thickness (Procreate Dreams' sidebar): a vertical
   * rail on the edge of the stage, for a hand that touches — a coarse pointer
   * or the first finger seen. Held (a finger, or a key a moment), it shows the
   * ring in the middle of the stage, at the sheet's scale.
   */
  let touchSeen = $state(false);
  let railHeld = $state<{ pointerId: number; x: number; y: number } | null>(null);
  let railTrack = $state<HTMLElement>();
  /** The size ring of a gesture: the Shift+drag where it began, the rail — or the sidebar's slider — in the middle. */
  const ring = $derived(
    // The magnet's size is its radius: its ring is twice that across.
    sizing ? { x: sizing.x, y: sizing.y, size: sizing.magnet ? sizing.size * 2 : sizing.size, magnet: sizing.magnet }
    : railHeld ? { x: railHeld.x, y: railHeld.y, size: editor.brushSizeLogical * (magnet ? 2 : 1), magnet }
    // The sidebar's slider: the ring alone — the number stands over the slider
    // (owner, 2026-10-05: «слово не нужно, а размер нужно»).
    : editor.sizeShown && !editor.playing ? { ...stageMiddle(), size: editor.brushSizeLogical * (magnet ? 2 : 1), magnet, bare: true }
    : null,
  );
  function stageMiddle(): { x: number; y: number } {
    const r = canvasRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function holdRail(pointerId: number): void {
    railHeld = { pointerId, ...stageMiddle() };
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
  // …nor after the rail itself went, the slider put on a panel under the hand.
  $effect(() => {
    if (!rail) railHeld = null;
  });
  /** A finger held still, waiting to become the pipette (hold-pick.ts). */
  let hold: { pointerId: number; x: number; y: number; timer: number } | null = null;
  /**
   * The pipette a held finger brought (Procreate Dreams' eyedropper): where
   * the finger is, the colour under it, and whether it is off the sheet.
   * `tool` — the pipette itself was in hand: the lift takes as the tool does.
   */
  let dropper = $state<{ pointerId: number; x: number; y: number; color: string | null; off: boolean; tool?: boolean } | null>(null);
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
    clearTimeout(wheelZoomTimer);
    // The pixels go with the canvas, now rather than when the collector gets
    // to them: Safari caps canvas memory, and a studio opened and left a few
    // times over held ten stage-sized buffers each. A frame already asked for
    // must not build them all again on a canvas that is gone.
    destroyed = true;
    cancelAnimationFrame(rafId);
    cancelAnimationFrame(glideRaf);
    clearTimeout(warmTimer);
    warmer.stop();
    crew?.close();
    if (studioCells.current === composer.cells) {
      studioCells.current = undefined;
    }
    composer.dispose();
    glComposer?.dispose();
    glComposer = null;
    try {
      glContext?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      // Context already gone.
    }
    glContext = null;
    played.release();
    for (const spare of [shotCanvas, canvasEl, glCanvasEl]) {
      if (spare) {
        spare.width = 0;
        spare.height = 0;
      }
    }
    navShot = null;
  });
  /** Pointer that is panning the canvas (middle button or the hand). */
  let panning = $state<{ pointerId: number; x: number; y: number; turn?: Twist } | null>(null);
  /**
   * A turn of the sheet under way: which way the hand pointed last, the angle
   * the sheet had when it took hold, and how far the hand has gone round
   * since — summed, so a magnet lets go once the hand has passed it.
   */
  interface Twist {
    dir: number;
    angle: number;
    twisted: number;
  }
  /** Active touch points, for two-finger pan and pinch. */
  const touches = new Map<number, { x: number; y: number }>();
  /** Pointers the canvas holds captured; the editor keys wait for all of them. */
  const heldPointers = new Set<number>();
  let gesture:
    | (Twist & { distance: number; midX: number; midY: number; zoom: number; slack: number | null })
    | null = null;
  /** Live mega-eraser gesture in document units, or null when idle. */
  let megaGesture = $state<number[] | null>(null);
  /**
   * The shapes tool's drag: where it was pressed and where the pointer is, in
   * document units, and the modifiers last heard — Shift and Alt act from the
   * moment they are held mid-drag (Krita). The cell is pinned like a line's.
   */
  // Raw: the layer and the cell are found again by identity, and a proxy is not them.
  let shapeGesture = $state.raw<{
    pointerId: number;
    a: [number, number];
    b: [number, number];
    square: boolean;
    fromCentre: boolean;
    /** The right button lays it in the fill colour, as a line. */
    swap: boolean;
    /** Drawn by a finger: a nearly even shape is pulled even (tools/shapes.ts). */
    touch: boolean;
    /**
     * A second finger down meanwhile: it is the finger's Shift (Procreate's
     * QuickShape) — no pinch begins, the shape is even while it lies.
     */
    second: number | null;
    layer: Layer | undefined;
    cell: CellMark;
  } | null>(null);
  /** The ruler while a hand drags or turns it; kept to the settings on release. */
  let rulerLive = $state.raw<Ruler | null>(null);
  /** The drag of the ruler: its body (from where), or an end. */
  let rulerGrab: { pointerId: number; base: Ruler; from: [number, number]; end: 1 | -1 | null } | null = null;
  /**
   * A line begun beside the ruler's edge: every point of it is laid on the
   * line through its press, parallel to the ruler (tools/ruler.ts).
   */
  let rulerLock: { pointerId: number; lay: (point: readonly [number, number]) => [number, number] } | null = null;
  /** What a press would take of the ruler under the cursor now, for the cursor's shape. */
  let rulerHover = $state<RulerHit['part'] | null>(null);
  /** The ruler on the sheet now: the one in the hand, else the one laid; none during the preview. */
  const shownRuler = $derived(editor.playing ? null : rulerLive ?? editor.ruler);
  /** The lasso's loop while it is being drawn, in document units. */
  let loopGesture = $state<number[] | null>(null);
  /** The cell the sweep began on, pinned like the line's. */
  let megaAt: { layer: Layer | undefined; cell: CellMark | undefined } = { layer: undefined, cell: undefined };
  /** Pointer owning the mega-eraser or distort gesture — only one runs at a time. */
  let gesturePointerId = -1;
  /** The magnet is held: what its press took follows the pointer until it is let go. */
  let magnetHeld = false;
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
    // The opacity is the brush's, not the tool's: whichever tool builds the
    // descriptor, a brush that paints lays it down as faint as it is set.
    return withOpacity((toolSpec(editor.brushTool)?.stroke ?? PENCIL).descriptor({
      ...editor.pluginBrush,
      width: brushWidthDoc(editor.brushSizeLogical),
    }), editor.brushOpacity, editor.brush.buildup);
  }

  /** The stroke the shapes drag would lay now, with the pencil's brush. */
  function shapeNow(drag: NonNullable<typeof shapeGesture>) {
    const brush = editor.pluginBrush;
    return shapeStroke(editor.settings.shapeKind, drag.a, drag.b, {
      square: drag.square || drag.second !== null,
      fromCentre: drag.fromCentre || editor.settings.shapeFromCentre,
      sides: editor.settings.shapeSides,
      pull: drag.touch ? unitsPerPx() : undefined,
    }, {
      width: brushWidthDoc(editor.brushSizeLogical),
      color: drag.swap ? editor.fillColor : brush.color,
      fill: drag.swap ? brush.color : brush.fill,
      opacity: editor.brushOpacity,
      buildup: editor.brush.buildup,
      filled: editor.settings.shapeFilled,
    });
  }

  /**
   * Button the live stroke was started with. Anything but the left one draws
   * with the fill colour (reference: `c.c = fillColour` for the gesture).
   */
  let strokeButton = 0;
  /**
   * The press on the sheet, and whether it has travelled: one that closed a
   * popup and went nowhere only closed it (owner, 2026-10-08) — its dot is not
   * drawn. `far` is kept from the moves: a ring drawn back to its start is a
   * stroke, though it ends where it began.
   */
  let press: { event: PointerEvent; far: boolean } | null = null;
  function onlyDismissed(e: PointerEvent): boolean {
    return !!press && press.event.pointerId === e.pointerId && !press.far
      && dismissedOnly(press.event, { dx: e.clientX - press.event.clientX, dy: e.clientY - press.event.clientY }, e.pointerType);
  }

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
  let strokeCell: CellMark | undefined;

  /**
   * The cell a gesture began on, to land it there however the strip moved
   * meanwhile: by its object — or, a continuation, by its place, since every
   * continuation is the same null.
   */
  type CellMark = { cell: Cell | undefined; frame: number };
  function markActive(): CellMark {
    return { cell: editor.activeCell, frame: editor.activeFrame };
  }
  /** Whether the cell the gesture began on is the active one still. */
  function stillActive(mark: CellMark): boolean {
    return mark.cell === editor.activeCell && (mark.cell !== null || mark.frame === editor.activeFrame);
  }
  /** Where that cell stands now in layer `layer`, or −1. */
  function frameOfMark(layer: number, mark: CellMark): number {
    const frames = editor.doc.layers[layer]?.frames;
    if (!frames || mark.cell === undefined) return -1;
    if (mark.cell === null) return frames[mark.frame] === null ? mark.frame : -1;
    return frames.indexOf(mark.cell);
  }

  /** How many sheets a playback holds ready on this device (`playback-window.ts`). */
  const playWindow = (sheet: { width: number; height: number }): number => playbackWindow(
    typeof navigator === 'undefined' ? undefined : (navigator as { deviceMemory?: number }).deviceMemory,
    sheet.width,
    sheet.height,
  );
  /** The frames of the playback under way, composed once each (playback-frames.ts). */
  const played = new PlaybackFrames<ImageData | ImageBitmap>((pixels) => {
    if ('close' in pixels) pixels.close();
  }, playWindow);
  /** What a played frame is kept as, by the browser (playback-frames.ts). */
  const keepAs = playbackKeeps(navigator.userAgent, typeof createImageBitmap === 'function');
  /**
   * Canvas 2D SheetComposer adapter over FrameComposer — shares the exact same
   * contract as `WebGL2SheetComposer` and `bench/run.ts`.
   */
  const composer = new Canvas2DSheetComposer(() => canvasEl, {
    cellBytes: CELL_CACHE_BYTES,
    playback: {
      get: (doc, width, height, key) => played.get(doc, { width, height }, key),
      keep: (doc, width, height, key, total, sheetCanvas, sheetCtx) => {
        const gen = backendGeneration;
        const size = { width, height };
        if (keepAs === 'bitmap') {
          createImageBitmap(sheetCanvas).then((bitmap) => {
            if (gen === backendGeneration && editor.playing && editor.doc === doc) {
              played.keep(doc, size, key, bitmap, total);
            } else {
              bitmap.close();
            }
          }, () => {
            // Drawn live, as before.
          });
        } else {
          try {
            played.keep(doc, size, key, sheetCtx.getImageData(0, 0, width, height), total);
          } catch {
            // Drawn live, as before.
          }
        }
      },
      release: () => played.release(),
    },
  });
  /** Rasterizes the cells of the frames around this one while the studio idles (cell-warm.ts). */
  const crew = cellCrew();
  studioCells.current = composer.cells;
  const warmer = new CellWarmer(composer.cells!, (task) => {
    // Safari has no idle callback: a short timeout stands in for it.
    const idle = globalThis.requestIdleCallback ?? null;
    if (idle) {
      const id = idle(task, { timeout: 1000 });
      return () => globalThis.cancelIdleCallback?.(id);
    }
    const id = setTimeout(task, 50);
    return () => clearTimeout(id);
  }, crew);
  let warmTimer: ReturnType<typeof setTimeout> | undefined;
  /** Scratch the bucket reads the active layer back from. */
  let fillEl: HTMLCanvasElement | null = null;
  /** The paper the bucket sees the colours on: BACKGROUND_COLOR. */
  const PAPER = [1, 3, 5].map((i) => parseInt(BACKGROUND_COLOR.slice(i, i + 2), 16));
  /** How many rings of a border's soft edge the fill reaches over. */
  const RIM_STEPS = 3;
  /** Colours nobody draws with, to see where a fill would be seen. */
  const PROBES = ['#ff00fe', '#00fe01', '#0100fe', '#fefe01'];
  /** The sheet's bitmap the composer's buffers hold; the pipette reads them by it. */
  let lastRaster: SheetRaster | null = null;
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
  // rail, the bar floating under the canvas — which is the
  // studio's, not the stage's, hence the search from the editor's root), in
  // the wrap's px. The sheet at 100 % is fitted
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
    const next = [...(wrapEl.closest('[data-float-root]') ?? wrapEl.parentElement ?? wrapEl).querySelectorAll<HTMLElement>('[data-over-sheet]')].map((el) => {
      const r = el.getBoundingClientRect();
      return clipCover(
        // The zoom window (`beside`): the sheet lies under it, and steps aside where it can.
        { x: Math.round(r.left - box.left), y: Math.round(r.top - box.top), width: Math.round(r.width), height: Math.round(r.height), shy: el.dataset.overSheet === 'beside', side: el.dataset.overSheet === 'side' || undefined },
        Math.round(box.width),
        Math.round(box.height),
      );
    });
    if (JSON.stringify(next) !== JSON.stringify(covers)) covers = next;
  }
  /** The hand let go: a cover that moved under it is measured now. */
  function settleCovers(): void {
    if (coversStale) {
      measureCovers();
    }
    if (glRestorePending && !drawingBusy()) {
      scheduleDraw();
    }
  }
  // A cover appears (the first finger), goes (display: none) or is resized
  // (text zoom); the wrap's own resize moves the corner ones. One that
  // becomes a cover later — the bar under the canvas unfolded, a column put
  // back — was not there to be watched when this ran: folded again, nobody
  // heard it go, and the sheet stayed fitted over a bar that was not there.
  // So the set itself is watched: the mark put on or taken off, a panel
  // added to or removed from the studio.
  $effect(() => {
    void editor.playing;
    void touchSeen;
    // The rail put on or taken off the stage is inside the wrap: no panel changed.
    void rail;
    if (!wrapEl || typeof ResizeObserver === 'undefined') return;
    const root = wrapEl.closest('[data-float-root]') ?? wrapEl.parentElement ?? wrapEl;
    const sizes = new ResizeObserver(() => measureCovers());
    const watch = (): void => {
      sizes.disconnect();
      sizes.observe(wrapEl!);
      for (const el of root.querySelectorAll('[data-over-sheet]')) sizes.observe(el);
      measureCovers();
    };
    watch();
    const marks = new MutationObserver(watch);
    marks.observe(root, { attributes: true, attributeFilter: ['data-over-sheet'], subtree: true });
    // Only the studio's own children: the panels. Its whole tree changes with every frame drawn.
    const panels = new MutationObserver(watch);
    panels.observe(root, { childList: true });
    return () => {
      sizes.disconnect();
      marks.disconnect();
      panels.disconnect();
    };
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
    foot: footOf(covers, Math.max(1, wrapWidth || sheetWidth), Math.max(1, wrapHeight || sheetHeight)),
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
      : editor.tool === 'drag' || editor.panHeld
        ? (panning ? 'grabbing' : 'grab')
        : editor.transform
          ? CURSOR_BY_MODE[hoverMode] || (editor.tool === 'lasso' ? 'default' : editor.tool === 'loop' ? 'crosshair' : '')
          // The lasso lays no line: a press takes the frame, so no brush ring.
          : editor.tool === 'lasso'
            ? 'default'
            // The loop is drawn from a point, not with a brush.
            : editor.tool === 'loop'
              ? 'crosshair'
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
  const cursorDiameter = $derived(magnet ? diameterOf(editor.brushSizeLogical * 2) : diameterOf(editor.brushSizeLogical));
  function diameterOf(size: number): number {
    return Math.max(1, (size * sheetWidth * editor.view.zoom) / (editor.doc.width / FIXED_POINT_SCALE));
  }
  /** Ring, cross, or the cross alone for a brush too thin to draw a circle for. */
  const cursorParts = $derived(cursorShape(editor.brushSizeLogical * (magnet ? 2 : 1), cursorDiameter, editor.ux.crossCursor && editor.settings.crossCursor, !!toolSpec(editor.brushTool)?.stroke?.grid));
  /**
   * The lasso, the bucket and the turn of a transform aim at a point: the
   * system's crosshair was a hair on some desktops and none on others, so
   * the cross is ours — the brush's, without its ring (owner, 2026-11-15).
   */
  const crossOnly = $derived(!editor.playing && overlayCursor === 'crosshair');

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

  /** The view the last composed frame was drawn under. */
  let lastDrawn: DrawnView | null = null;
  /** That frame, copied when a pan or pinch starts, and the view it was drawn in. */
  let navShot: { canvas: HTMLCanvasElement; view: DrawnView; at: number } | null = null;
  let shotCanvas: HTMLCanvasElement | undefined;
  /**
   * How often the frame is composed afresh under a moving hand, once the shot
   * no longer holds what the hand brought onto the table, ms. The calibration
   * knob: lower fills the sheet in sooner, higher spares a weak phone.
   */
  const NAV_COMPOSE_MS = 100;

  function takeNavShot(): void {
    // WebGL2 presents live GPU textures directly without copying the hidden 2D
    // canvas, which WebGL2 draws leave stale.
    if (webglVisible || !canvasEl || !lastDrawn || navShot || rafPending) {
      return;
    }
    // Nor through the preview: nobody shows it there (`draw`), and every frame
    // of the film dropped it — a copy of the whole table per frame, for nothing.
    if (editor.playing) {
      return;
    }
    shotCanvas ??= document.createElement('canvas');
    shotCanvas.width = canvasEl.width;
    shotCanvas.height = canvasEl.height;
    // No context (Safari out of canvas memory): no shot. A blank one showed
    // an empty sheet for the whole gesture; without one the frame is composed.
    const shotCtx = shotCanvas.getContext('2d');
    if (!shotCtx) {
      return;
    }
    shotCtx.drawImage(canvasEl, 0, 0);
    navShot = { canvas: shotCanvas, view: lastDrawn, at: performance.now() };
  }

  /** Sets the canvas to axes turned by `angle` degrees about (x, y), `k` pixels to a unit. */
  function turned(ctx: ViewCtx, k: number, angle: number, x: number, y: number): void {
    const a = (angle * Math.PI) / 180;
    ctx.setTransform(k * Math.cos(a), k * Math.sin(a), -k * Math.sin(a), k * Math.cos(a), x, y);
  }

  function draw(): void {
    if (!canvasEl || destroyed) {
      return;
    }
    // toonio.ru draws into a fixed 1280×720 bitmap the browser then scales to
    // the element, whatever the screen density — so its lines are rasterized
    // at one bitmap pixel per logical document pixel, never per device pixel.
    // It is the preset's rasterisation: one document, one bitmap, whatever
    // canvas the brush in hand measures on.
    // The preset that rasterizes in the document's own density keeps it: there
    // the bitmap is the document's, not the screen's. It goes through the cap
    // all the same: a phone's 360 px sheet asked 3.5× of a 1280 document, and
    // the buffers the cap is there for ran to ~60 MB (owner, twelfth audit).
    const dpr = renderDensity(editor.ux.canvasDensity === 'document'
      ? editor.doc.width / FIXED_POINT_SCALE / sheetWidth
      : window.devicePixelRatio || 1);
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
    if (frame >= (editor.doc.layers[0]?.frames.length ?? 0)) {
      return;
    }

    // The frame itself — the layers around the active one, the ghosts, the
    // line under the hand — is put together by the shared composer, the same
    // one the benchmark runs. What is left here is the editor's canvas: the
    // paper the frame lies on, the clip to its edges, a tool's grid over it.
    const sheet = {
      x: editor.view.panX * dpr,
      y: editor.view.panY * dpr,
      w: sheetWidth * editor.view.zoom * dpr,
      h: sheetHeight * editor.view.zoom * dpr,
    };
    // The frame is a bitmap of the sheet, not of the screen: a pixel per pixel
    // of the document is the picture, the same for everyone who opens it, and
    // the view only stretches it. Rasterized for whatever zoom the hand had
    // left it at, the same drawing had a hairline here at one zoom and not at
    // another (owner, 2026-10-10).
    const perPixel = (sheet.w * FIXED_POINT_SCALE) / editor.doc.width;
    const raster = sheetRaster(editor.doc);
    const viewport = { scale: raster.level / FIXED_POINT_SCALE, dpr: 1 };
    const stretch = perPixel / raster.level;
    const ghosts = editor.showOnionSkin
      ? { frames: editor.onionSkinLayers, layers: editor.onionHistoryLayerIndices }
      : undefined;
    const live = liveLine(viewport);
    const still = editor.playing && !ghosts && !live;
    const playKey = still ? stillStart(editor.doc, frame) : frame;
    const scene: FrameScene = {
      doc: editor.doc,
      frame,
      activeLayer: editor.activeLayer,
      viewport,
      tools: previewTools,
      cellAt: stackCell,
      ghosts,
      live,
      alpha: editor.playing ? 1 : editor.onionBlends ? ONION_BLEND_ALPHA : editor.ux.activeFrameAlpha,
      blend: editor.onionBlends,
      paper: BACKGROUND_COLOR,
    };
    const present: StagePresentParams = {
      stageWidth: pxWidth,
      stageHeight: pxHeight,
      sheetX: sheet.x,
      sheetY: sheet.y,
      sheetW: sheet.w,
      sheetH: sheet.h,
      angle: editor.view.angle,
      stretch,
      paper: BACKGROUND_COLOR,
      gridStep: toolSpec(editor.brushTool)?.stroke?.grid && !editor.playing ? cursorDiameter * dpr : 0,
    };
    const playArg = still ? { doc: editor.doc, key: playKey, total: frameCount(editor.doc) } : undefined;

    // Hardware WebGL2 path: validate and promote the real candidate context,
    // keeping Canvas 2D visible until the actual current scene renders cleanly.
    if (editor.settings.hardwareRender && glCanvasEl && !glSessionRetired && !glContextLost) {
      const budgetForContext = (ctx: WebGL2RenderingContext): number => {
        glMaxTextureSize = Number(ctx.getParameter(ctx.MAX_TEXTURE_SIZE)) || 0;
        return studioVramBudget({
          deviceMemory: typeof navigator === 'undefined' ? undefined : (navigator as { deviceMemory?: number }).deviceMemory,
          maxTextureSize: glMaxTextureSize,
          coarsePointer: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
        });
      };
      if (glRestorePending && glContext && !drawingBusy()) {
        glRestorePending = false;
        const minDim = Math.max(MIN_WEBGL2_DIMENSION, raster.width, raster.height, pxWidth, pxHeight);
        const reval = validateWebGL2Candidate(glContext, minDim);
        if (reval.ok && reval.fboFormats) {
          glFormats = reval.fboFormats;
          glComposer = new WebGL2SheetComposer(glContext, { formats: glFormats, budgetBytes: budgetForContext(glContext) });
        } else {
          retireWebGL('context-lost', true);
        }
      } else if (!glComposer && !glProbed && !glRestorePending) {
        const minDim = Math.max(MIN_WEBGL2_DIMENSION, raster.width, raster.height, pxWidth, pxHeight);
        const acquired = acquireStudioWebGL2(glCanvasEl, minDim);
        glProbed = true;
        glSoftwareBrowser = acquired.capability.isSoftwareBrowser;
        if (acquired.gl && acquired.capability.webgl2Eligible && acquired.capability.fboFormats) {
          glContext = acquired.gl;
          glFormats = acquired.capability.fboFormats;
          glComposer = new WebGL2SheetComposer(glContext, { formats: glFormats, budgetBytes: budgetForContext(glContext) });
        } else {
          editor.renderBackend = {
            active: 'canvas2d',
            reason: acquired.capability.reason,
            isSoftwareBrowser: acquired.capability.isSoftwareBrowser,
          };
        }
      }

      if (glComposer && glCanvasEl && glContext) {
        if (glCanvasEl.width !== pxWidth) glCanvasEl.width = pxWidth;
        if (glCanvasEl.height !== pxHeight) glCanvasEl.height = pxHeight;
        const lostNow = glContext.isContextLost();
        const maxTex = lostNow ? 0 : glMaxTextureSize;
        const fitsSurface = !lostNow
          && glContext.drawingBufferWidth === pxWidth
          && glContext.drawingBufferHeight === pxHeight
          && raster.width <= maxTex
          && raster.height <= maxTex;
        if (!fitsSurface) {
          webglVisible = false;
          navShot = null;
          lastDrawn = null;
          if (lostNow) {
            handleRecoverableContextLoss();
          } else {
            editor.renderBackend = { active: 'canvas2d', reason: 'budget-exceeded', isSoftwareBrowser: false };
          }
        } else {
          const ok = glComposer.composeAndPresent(raster.width, raster.height, scene, present, playArg);
          if (ok) {
            lastDrawn = { ...editor.view, dpr };
            lastRaster = raster;
            navShot = null;
            if (!webglVisible) {
              // Invalidate outgoing Canvas 2D async callbacks & playback stills upon promotion.
              backendGeneration += 1;
              played.release();
              webglVisible = true;
            }
            if (editor.renderBackend.active !== 'webgl2') {
              editor.renderBackend = { active: 'webgl2', reason: 'webgl2', isSoftwareBrowser: false };
            }
            clearTimeout(warmTimer);
            warmer.stop();
            return;
          }
          webglVisible = false;
          const failure = glComposer.lastFailure;
          if (failure === 'oom') {
            retireWebGL('oom', true);
          } else if (failure === 'budget-exceeded') {
            navShot = null;
            lastDrawn = null;
            editor.renderBackend = { active: 'canvas2d', reason: 'budget-exceeded', isSoftwareBrowser: false };
          } else {
            handleRecoverableContextLoss();
          }
        }
      }
    } else if (webglVisible) {
      webglVisible = false;
      navShot = null;
      lastDrawn = null;
    }

    const drawn: DrawnView = { ...editor.view, dpr };
    const uncovered = navShot !== null && !shotCovers(navShot.view, drawn, stage);
    if (navShot && uncovered && performance.now() - navShot.at >= NAV_COMPOSE_MS) {
      navShot = null;
    }
    const shot = navShot && navigating() && !editor.playing ? navShot : null;
    if (uncovered && shot) {
      scheduleDraw();
    }
    if (shot) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, pxWidth, pxHeight);
      turned(ctx, 1, editor.view.angle, sheet.x, sheet.y);
      ctx.fillStyle = BACKGROUND_COLOR;
      ctx.fillRect(0, 0, sheet.w, sheet.h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, sheet.w, sheet.h);
      ctx.clip();
      try {
        const to = reprojection(shot.view, drawn);
        turned(ctx, to.scale, to.turn, to.x, to.y);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(shot.canvas, 0, 0);
      } finally {
        ctx.restore();
      }
    } else {
      if (!composer.composeAndPresent(raster.width, raster.height, scene, present, playArg)) {
        return;
      }
      lastDrawn = drawn;
      lastRaster = raster;
      clearTimeout(warmTimer);
      if (live) {
        warmer.stop();
      } else {
        const warmScene = {
          doc: editor.doc, frame, tools: editor.doc.tools, viewport,
          width: raster.width, height: raster.height,
          ahead: editor.playing ? playWindow(raster) : undefined,
        };
        warmTimer = setTimeout(() => warmer.request(warmScene), editor.playing ? 0 : 150);
      }
    }
    // A frame composed under a moving hand — no shot could be taken when it
    // took hold, or what the shot showed has changed since — is the shot now.
    if (navigating() && !editor.playing) {
      takeNavShot();
    }
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
   * The open session's matrix, worked out once a change of the session rather
   * than at every point of every stroke it carries — and the same array while
   * the session stands, so the stack sees nothing new to draw.
   */
  const placing = $derived.by(() => {
    const open = editor.transform;
    return open ? sessionMatrix(open.session, open.box) : null;
  });

  /**
   * A layer's cell as the stack should draw it: the lasso takes whole cells,
   * so a selected one is rasterized already moved rather than left in its old
   * place with a preview on top.
   */
  function stackCell(layer: number, frame: number): Frame | undefined {
    const row = editor.doc.layers[layer];
    const cell = row && frame < row.frames.length ? resolveCell(row, frame) : undefined;
    const open = editor.transform;
    if (!cell || !open || frame !== editor.activeFrame || !open.layers.includes(layer)) {
      return cell;
    }
    // A loop's cut shows once the selection has moved, as it is written: until
    // then every line is whole, and drawn whole. A paste shows at once.
    const cut = open.picked?.[open.layers.indexOf(layer)];
    if (cut && !open.pasted && sameSession(open.session, EMPTY_TRANSFORM)) {
      return cell;
    }
    const indices = cut && new Set(cut.indices);
    const matrix = placing!;
    // A shift, a turn or a mirror leaves every line its shape: drawn from its
    // own points under the matrix, its kept path is drawn again and no new one
    // is built (owner, 2026-11-16). A stamp is laid back on its grid, so it
    // goes the way apply writes it.
    const rigid = keepsShape(open.session);
    return {
      strokes: (cut?.strokes ?? cell.strokes).map((stroke, index) => {
        if (indices && !indices.has(index)) {
          return stroke;
        }
        if (rigid && editor.doc.tools[stroke.tool_id]?.kind !== 'stamp') {
          return { ...stroke, place: matrix };
        }
        // The scaled copies sit right after the real table, at the same offsets.
        // The same placing apply will perform, so the drag shows the real
        // result instead of a smooth version of it that snaps on Enter.
        const tool_id = open.widthWithScale ? stroke.tool_id + editor.doc.tools.length : stroke.tool_id;
        const points = placeStrokePoints(
          stroke.points,
          (x, y) => applyMatrix(matrix, x, y),
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
    return toWorkspace(x, y, { width: sheetWidth, height: sheetHeight }, editor.doc, editor.view);
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
    if (megaGesture && megaGesture.length >= 2 && megaAt.cell && stillActive(megaAt.cell)) {
      const gesture = megaGesture;
      const width = brushWidthDoc(editor.brushSizeLogical);
      return {
        id: nodeId(gesture),
        erase: true,
        spec: { kind: 'raw-polyline', points: gesture, width, color: BACKGROUND_COLOR },
        paint: (target) => renderRawPolyline(
          gesture,
          // The width the gesture really cuts with: the cut on release takes
          // the same normalised radius, and so does the cursor ring.
          width,
          BACKGROUND_COLOR,
          target,
          viewport,
        ),
      };
    }
    if (shapeGesture && stillActive(shapeGesture.cell)) {
      const drag = shapeGesture;
      const stroke = shapeNow(drag);
      if (!stroke) return null;
      const tool = stroke.tool as LineToolDescriptor;
      const color = 'color' in tool ? tool.color : BACKGROUND_COLOR;
      const alpha = isFlatPaint(tool) ? 1 : (opacityOf(tool).opacity ?? 100) / 100;
      return {
        id: nodeId(drag),
        flat: isFlatPaint(tool) ? tool : undefined,
        points: stroke.points,
        erase: false,
        spec: { kind: 'resolved', points: stroke.points, tool, color, alpha },
        paint: (target) => {
          if (!isFlatPaint(tool)) target.globalAlpha = alpha;
          try {
            renderResolvedPreview(stroke.points, tool, color, target, viewport);
          } finally {
            target.globalAlpha = 1;
          }
        },
      };
    }
    const session = pointer.session;
    if (!session || strokeLayer !== editor.doc.layers[editor.activeLayer] || !strokeCell || !stillActive(strokeCell)) {
      return null;
    }
    const erase = session.descriptor.kind === 'eraser';
    const color = erase ? BACKGROUND_COLOR : session.descriptor.color;
    const geometry = session.rules.previewGeometry ?? session.descriptor.geometry;
    // A pen's line changes width along it and is redrawn whole, like a feather —
    // where the brush takes the pressure; one that does not grows as under a mouse.
    // So is a translucent one: added to part by part, it darkened at every join.
    const grows = !drawsPressure(session) && session.descriptor.kind === 'pencil'
      && opacityOf(session.descriptor).opacity === undefined
      && (geometry === 'line' || geometry === 'smooth');
    if (!grows) {
      const points = session.rules.previewGeometry === 'line' ? session.rawPoints : previewStrokeSession(session);
      const raw = session.rules.previewGeometry === 'line';
      const pressure = previewStrokePressure(session, points);
      const alpha = isFlatPaint(session.descriptor) ? 1 : (opacityOf(session.descriptor).opacity ?? 100) / 100;
      const spec: DeclarativeLiveStroke = pressure
        ? {
            kind: 'resolved',
            points,
            tool: raw ? { ...session.descriptor, geometry: 'line' as const } : session.descriptor,
            color,
            pressure,
            alpha,
          }
        : raw
          ? {
              kind: 'raw-polyline',
              points: session.rawPoints.length >= 4 ? session.rawPoints : [],
              width: session.descriptor.width,
              color,
              fill: isFilledLineTool(session.descriptor) ? session.descriptor.fill : undefined,
              alpha,
            }
          : {
              kind: 'resolved',
              points,
              tool: session.descriptor,
              color,
              alpha,
            };
      return {
        id: nodeId(session),
        flat: isFlatPaint(session.descriptor) ? session.descriptor : undefined,
        points,
        erase,
        spec,
        paint: (target) => renderSessionPreview(session, target, viewport, color, points),
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

  /** The line under the hand, as faint as the one that lands. */
  function renderSessionPreview(
    session: NonNullable<typeof pointer.session>,
    target: Canvas2DLike,
    viewport: Viewport,
    color: string,
    points: readonly number[],
  ): void {
    if (!isFlatPaint(session.descriptor)) target.globalAlpha = (opacityOf(session.descriptor).opacity ?? 100) / 100;
    try {
      paintSessionPreview(session, target, viewport, color, points);
    } finally {
      target.globalAlpha = 1;
    }
  }

  function paintSessionPreview(
    session: NonNullable<typeof pointer.session>,
    target: Canvas2DLike,
    viewport: Viewport,
    color: string,
    points: readonly number[],
  ): void {
    const raw = session.rules.previewGeometry === 'line';
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
      renderResolvedPreview(points, session.descriptor, color, target, viewport);
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

  function scheduleDraw(): void {
    if (rafPending) {
      return;
    }
    rafPending = true;
    rafId = requestAnimationFrame(() => {
      rafPending = false;
      draw();
    });
  }

  const drawFrame = $derived(editor.playing && !editor.showOnionSkin
    ? stillStart(editor.doc, editor.displayedFrame)
    : editor.displayedFrame);

  $effect(() => {
    // Everything the three buffers are built from. The document is one value
    // and a write replaces it, so reading it here is the whole subscription —
    // the walk over every layer's cell that used to stand for it is gone, and
    // with it a read per cell per stroke.
    void sheetWidth;
    void editor.doc;
    void drawFrame;
    void editor.activeLayer;
    void editor.showOnionSkin;
    void editor.onionHistoryLayerIndices.length;
    void editor.settings.onion;
    void editor.ux;
    void editor.view;
    void editor.transform;
    composer.invalidate();
    glComposer?.invalidate();
    scheduleDraw();
  });

  // Live toggle between hardware WebGL2 and software Canvas 2D without losing the canvas state.
  let prevHardwarePref: boolean | undefined;
  $effect(() => {
    const want = editor.settings.hardwareRender;
    if (prevHardwarePref === undefined) {
      prevHardwarePref = want;
      if (!want) {
        editor.renderBackend = { active: 'canvas2d', reason: 'disabled', isSoftwareBrowser: glSoftwareBrowser };
      }
      return;
    }
    if (want === prevHardwarePref) return;
    prevHardwarePref = want;
    if (!want) {
      retireWebGL('disabled', true);
      glProbed = false;
      glSessionRetired = null;
      glContextLost = false;
      glRestorePending = false;
      scheduleDraw();
    } else {
      // Fresh candidate canvas while Canvas 2D stays visible until first WebGL2 draw succeeds.
      glSessionRetired = null;
      glProbed = false;
      glContextLost = false;
      glRestorePending = false;
      glLossTimes = [];
      navShot = null;
      lastDrawn = null;
      glMountKey += 1;
      scheduleDraw();
    }
  });

  // Listen to WebGL2 context loss & restoration on the mounted glCanvasEl without unmounting it.
  $effect(() => {
    const el = glCanvasEl;
    if (!el) return;
    const onLost = (e: Event): void => {
      // Ignore intentional loseContext() triggered during probe rejection or manual disable.
      if (glIntentionalLose || (!glContext && !glContextLost)) return;
      if (!glSessionRetired) e.preventDefault();
      handleRecoverableContextLoss();
      scheduleDraw();
    };
    const onRestored = (): void => {
      if (glSessionRetired || !editor.settings.hardwareRender) return;
      glContextLost = false;
      glRestorePending = true;
      scheduleDraw();
    };
    el.addEventListener('webglcontextlost', onLost);
    el.addEventListener('webglcontextrestored', onRestored);
    return () => {
      el.removeEventListener('webglcontextlost', onLost);
      el.removeEventListener('webglcontextrestored', onRestored);
    };
  });

  // The shot is the picture as the hand grabbed it. What it is made of changed
  // under the moving hand — a key in the tail of a trackpad fling, a button
  // under the other hand, the film ending mid-pan — and the old frame stayed
  // on the sheet until the hand let go. The shot goes, and `draw` takes
  // another off the frame it composes. Not the view: the gesture is what
  // changes it. The table is: resized under the hand, it refits the sheet, and
  // the shot lay on it at the old fit.
  $effect(() => {
    void stage;
    void editor.doc;
    void editor.displayedFrame;
    void editor.activeLayer;
    void editor.showOnionSkin;
    void editor.onionHistoryLayerIndices.length;
    void editor.settings.onion;
    void editor.ux;
    void editor.transform;
    void editor.tool;
    void editor.playing;
    navShot = null;
  });

  // The pixel grid is painted over the composited stack, so picking the tool
  // or resizing its cell repaints the canvas — without invalidating buffers
  // that have not changed.
  $effect(() => {
    void editor.tool;
    void editor.playing;
    void cursorDiameter;
    scheduleDraw();
  });

  // The frames kept for a playback go when it stops.
  $effect(() => {
    if (!editor.playing) {
      played.release();
      glComposer?.clearPlayback();
    }
  });

  // A window dragged to a screen of another density changes nothing else the
  // canvas watches — the stage keeps its CSS size — so the lines stayed at the
  // old screen's density. The screen itself says when it changes.
  $effect(() => {
    let query: MediaQueryList;
    const moved = (): void => {
      composer.invalidate();
      glComposer?.invalidate();
      scheduleDraw();
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
    return (captureStageEl ?? canvasEl).getBoundingClientRect();
  }

  /** Document units one CSS pixel of the screen spans at the zoom in hand. */
  function unitsPerPx(): number {
    return editor.doc.width / Math.max(1e-6, sheetWidth * editor.view.zoom);
  }

  /** What a press at the event would take of the ruler, if it is out. */
  function rulerHitAt(e: { clientX: number; clientY: number }, rect?: DOMRect): RulerHit | null {
    const ruler = shownRuler;
    return ruler ? hitRuler(ruler, toDocUnits(e, rect), unitsPerPx()) : null;
  }

  /** The ruler's band, its ticks along one edge, in the overlay's CSS pixels. */
  const rulerShape = $derived.by(() => {
    const ruler = shownRuler;
    if (!ruler) return null;
    // Read the view so a zoom or a pan redraws it.
    void editor.view.zoom, editor.view.panX, editor.view.panY, editor.view.angle, sheetWidth, sheetHeight;
    const cos = Math.cos(ruler.angle);
    const sin = Math.sin(ruler.angle);
    const half = ruler.length / 2;
    const [ax, ay] = toScreen(ruler.x - cos * half, ruler.y - sin * half);
    const [bx, by] = toScreen(ruler.x + cos * half, ruler.y + sin * half);
    const length = Math.hypot(bx - ax, by - ay);
    if (length < 1) return null;
    const ux = (bx - ax) / length;
    const uy = (by - ay) / length;
    const h = RULER_THICKNESS_PX / 2;
    const [nx, ny] = [-uy * h, ux * h];
    const band = [ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny];
    // A tick every 12 px, every fifth one longer, standing in from the edge.
    let ticks = '';
    for (let i = 1, at = 12; at < length; i++, at += 12) {
      const deep = (i % 5 === 0 ? 0.5 : 0.25) * RULER_THICKNESS_PX / h;
      const px = ax + ux * at + nx;
      const py = ay + uy * at + ny;
      ticks += `M${px.toFixed(1)} ${py.toFixed(1)}l${(-nx * deep).toFixed(1)} ${(-ny * deep).toFixed(1)}`;
    }
    return { band: band.map((v) => v.toFixed(1)).join(' '), ticks };
  });

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
    if (!lastRaster) {
      return undefined;
    }
    const source = pickSource(editor.pickSource, e.altKey);
    const activeComposer: SheetComposer = webglVisible && glComposer ? glComposer : composer;
    const [ux, uy] = toDocUnits(e);
    const px = Math.min(lastRaster.width - 1, Math.max(0, Math.floor((ux / FIXED_POINT_SCALE) * lastRaster.level)));
    const py = Math.min(lastRaster.height - 1, Math.max(0, Math.floor((uy / FIXED_POINT_SCALE) * lastRaster.level)));
    const seen = source === 'canvas' ? editor.doc.layers.filter((layer) => !layer.hidden) : [];
    const handleGlSampleFailure = (): void => {
      if (activeComposer !== glComposer || !glComposer?.lastFailure) return;
      if (glComposer.lastFailure === 'oom') {
        retireWebGL('oom', true);
      } else {
        handleRecoverableContextLoss();
      }
      scheduleDraw();
    };
    const raw = activeComposer.samplePixel({ px, py, source, onPaper: false, paper: BACKGROUND_COLOR });
    if (!raw) {
      handleGlSampleFailure();
      return undefined;
    }
    const picked = colourOfPixel(raw, editor.doc.tools, undefined, seen.flatMap((layer) => layer.opacity ?? []));
    if (picked === null || !seen.some((layer) => layer.blend)) {
      return picked;
    }
    const onPaper = activeComposer.samplePixel({ px, py, source, onPaper: true, paper: BACKGROUND_COLOR });
    if (!onPaper) {
      handleGlSampleFailure();
      return undefined;
    }
    return '#' + [onPaper[0], onPaper[1], onPaper[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
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
   * The bucket's press: the colour seen under it — on the active cell or, by the
   * bucket's box, on every visible one, paper under them — and the whole
   * connected area of that colour, whatever made it, goes into the layer as a
   * contour, in place of the old fills it pours over (tools/fill.ts). The
   * contour lies as low as it stays seen all over the area, which is under its
   * borders, over what it recolours. It pours the outline's colour, and the
   * fill's from the right button, as a line is drawn.
   */
  function pour(e: PointerEvent): void {
    const row = editor.doc.layers[editor.activeLayer];
    const cell = row && resolveCell(row, editor.activeFrame);
    if (!cell || !lastRaster) {
      return;
    }
    const { level, width: w, height: h } = lastRaster;
    fillEl = buffer(fillEl, w, h);
    const ctx = fillEl.getContext('2d', { willReadFrequently: true }) as unknown as ViewCtx | null;
    if (!ctx) {
      return;
    }
    const plain = ctx as unknown as CanvasRenderingContext2D;
    const clear = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
    };
    const viewport = { scale: level / FIXED_POINT_SCALE, dpr: 1 };
    const { tools } = editor.doc;
    clear();
    const shown = editor.settings.fillSource === 'canvas' ? editor.doc.layers.filter((layer) => !layer.hidden) : [];
    const cells = shown.length > 0 ? shown.map((layer) => resolveCell(layer, editor.activeFrame)) : [cell];
    // A layer that erases is drawn apart, so its eraser cuts its own lines
    // alone; one with a look is laid with it — the colour seen is the one filled.
    renderLayersStacked(cells, tools, ctx, viewport, () => {
      const own = buffer(null, w, h);
      return { ctx: own.getContext('2d') as unknown as ViewCtx, image: own };
    }, STUDIO_PATHS, shown.length > 0 ? shown : undefined);
    const rgba = plain.getImageData(0, 0, w, h).data;
    // A blended layer is seen over the paper, not over nothing: the colours the
    // fill compares are those of the frame laid on the paper, as the renderers
    // lay it. Where ink is and where the paper is bare is still read above.
    let seen = rgba;
    if (shown.some((layer) => layer.blend)) {
      const onPaperEl = buffer(null, w, h);
      const pctx = onPaperEl.getContext('2d', { willReadFrequently: true }) as unknown as ViewCtx | null;
      if (pctx) {
        pctx.fillStyle = BACKGROUND_COLOR;
        pctx.fillRect(0, 0, w, h);
        renderLayersStacked(cells, tools, pctx, viewport, () => {
          const own = buffer(null, w, h);
          return { ctx: own.getContext('2d') as unknown as ViewCtx, image: own };
        }, STUDIO_PATHS, shown, true);
        seen = (pctx as unknown as CanvasRenderingContext2D).getImageData(0, 0, w, h).data;
        onPaperEl.width = onPaperEl.height = 0;
      }
    }
    const [ux, uy] = toDocUnits(e);
    const x = Math.min(w - 1, Math.max(0, Math.floor((ux / FIXED_POINT_SCALE) * level)));
    const y = Math.min(h - 1, Math.max(0, Math.floor((uy / FIXED_POINT_SCALE) * level)));
    const distance = colourDistance(seen, w, h, x, y, PAPER);
    // Only an empty place runs out through a break in its border: ink ends where
    // it was drawn, and a line's own narrow places are no breaks to hold at.
    const onPaper = rgba[(y * w + x) * 4 + 3] === 0;
    const gap = onPaper ? editor.settings.fillGap * level : 0;
    const area = fillRegion(distance, w, h, x, y, (editor.settings.fillTolerance * 255) / 100, gap);
    const toDoc = FIXED_POINT_SCALE / level;
    const replaced = oldFillsIn(area, w, h, cell.strokes, tools, 1 / toDoc);
    const kept = cell.strokes.filter((_, i) => !replaced.includes(i));
    const pure = pureOf(area, distance);
    const colour = e.button === 2 ? editor.fillColor : editor.brushColor;
    const same = recolouredFill(pure, replaced, cell.strokes, tools, 1 / toDoc, w, h);
    if (same !== null) {
      editor.applyFill(cell.strokes[same].points, colour, same, replaced);
      return;
    }

    // What the fill may grow over freely: the paper is nothing to eat. Ink over
    // the fill is known once its slot is; until then, nothing is taken for covered.
    const empty = distanceField(w, h, (p) => rgba[p * 4 + 3] === 0);
    const byPaper = new Uint8Array(w * h);
    for (let p = 0; p < byPaper.length; p++) byPaper[p] = empty[p] <= RIM_STEPS ? 1 : 0;

    /** The area's outline in document units, or null when nothing is left of it. */
    const outline = (covered: Uint8Array): number[] | null => {
      const grown = area.slice();
      growRim(grown, distance, w, h, RIM_STEPS, covered, byPaper);
      // The staircase of pixel edges straightened; a hole straightened down to
      // a line is no hole.
      const [outer, ...holes] = traceRings(grown, w, h).map(smoothRing);
      return outer.length < 6
        ? null
        : keyhole([outer, ...holes.filter((hole) => hole.length >= 6)]).map((v) => clampCoord(Math.round(v * toDoc)));
    };
    const onTop = outline(new Uint8Array(w * h));
    if (!onTop) {
      return;
    }

    // Where the fill goes: drawn into each slot tried in a colour nobody uses.
    const probe = PROBES.find((c) => !tools.some((tool) => 'color' in tool && tool.color === c)) ?? PROBES[0];
    const [pr, pg, pb] = [1, 3, 5].map((i) => parseInt(probe.slice(i, i + 2), 16));
    const trial = { points: onTop, tool_id: tools.length };
    const trialTools = [...tools, { kind: 'contour' as const, geometry: 'line' as const, color: probe }];
    const seenAt = (slot: number): number => {
      clear();
      renderStrokesLayer({ strokes: [...kept.slice(0, slot), trial, ...kept.slice(slot)] }, trialTools, ctx, viewport, undefined, STUDIO_PATHS);
      const seen = plain.getImageData(0, 0, w, h).data;
      let count = 0;
      for (const p of pure) {
        const i = p * 4;
        if (seen[i + 3] >= 250 && Math.abs(seen[i] - pr) <= 8 && Math.abs(seen[i + 1] - pg) <= 8 && Math.abs(seen[i + 2] - pb) <= 8) {
          count++;
        }
      }
      return count;
    };
    const slot = lowestSeenSlot(kept.length, seenAt);
    let ring = onTop;
    if (slot < kept.length) {
      clear();
      renderStrokesLayer({ strokes: kept.slice(slot) }, tools, ctx, viewport, undefined, STUDIO_PATHS);
      const over = plain.getImageData(0, 0, w, h).data;
      const covered = new Uint8Array(w * h);
      for (let p = 0; p < covered.length; p++) covered[p] = over[p * 4 + 3] > 0 ? 1 : 0;
      ring = outline(covered) ?? onTop;
    }
    editor.applyFill(ring, colour, slot, replaced);
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
    if (panning) {
      panning = null;
      dropNavShot();
    }
    try {
      capturePointer(pointerId);
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

  /**
   * The finger lifted with the pipette itself in hand: the take is the
   * tool's own — the fill when armed, the eraser from emptiness, and back to
   * the brush.
   */
  function liftPipette(e: PointerEvent): void {
    const at = { clientX: e.clientX, clientY: e.clientY, altKey: false };
    dropper = null;
    if (offSheet(at)) {
      return;
    }
    const toFill = editor.pipetteTarget === 'fill';
    if (takeColour(at, toFill) !== null) {
      editor.resetHelpTool();
    }
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
    // A second finger while a finger frames a shape is that finger's Shift:
    // taken here, before it could make a pinch and drop the shape. Any more
    // fingers meanwhile are swallowed too — none of them is in `touches`, so
    // a third would otherwise have made the pair of a pinch.
    if (e.pointerType === 'touch' && shapeGesture?.touch && e.pointerId !== shapeGesture.pointerId) {
      if (shapeGesture.second === null) {
        shapeGesture = { ...shapeGesture, second: e.pointerId };
        // Held, so its lift off the canvas still comes here (endNavigation).
        capturePointer(e.pointerId);
        scheduleDraw();
      }
      return true;
    }
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
        takeNavShot();
        return true;
      }
      if (touches.size > 1) {
        return true;
      }
      // One finger: the hand below still pans with it.
    }
    // The hand is the tool whose whole job is this gesture (reference `Drag`);
    // once a pen has been used, a finger is always the hand.
    if (e.button === 1 || editor.tool === 'drag' || editor.panHeld || (e.pointerType === 'touch' && editor.penSeen)) {
      // A held key's hand was used: letting the key go is no tap (keymap holdKey).
      if (editor.panHeld) editor.panHeldUsed = true;
      panning = {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        // With Shift the same drag turns the sheet about the middle of the
        // table instead of sliding it (Krita, Clip Studio). Fingers twist.
        turn: e.shiftKey && e.pointerType !== 'touch'
          ? { dir: aroundTable(e), angle: editor.view.angle, twisted: 0 }
          : undefined,
      };
      capturePointer(e.pointerId);
      takeNavShot();
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
    shapeGesture = null;
    // A ruler let go of by a lost capture stays where the hand left it.
    if (rulerGrab && rulerLive) editor.placeRuler(rulerLive);
    rulerGrab = null;
    rulerLive = null;
    loopGesture = null;
    releaseMagnet();
    releasePluginGrab();
    gesturePointerId = -1;
  }

  /** Lets go of the magnet: whatever it moved is one step of undo. */
  function releaseMagnet(): void {
    if (magnetHeld) {
      magnetHeld = false;
      gesturePointerId = -1;
      editor.endMagnet();
    }
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
      dir: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      angle: editor.view.angle,
      twisted: 0,
      // Until the fingers have twisted past the slop the sheet does not turn:
      // no pinch is quite straight.
      slack: null as number | null,
    };
  }

  function panBy(dx: number, dy: number): void {
    editor.view = clampPan(
      { ...editor.view, panX: editor.view.panX + dx, panY: editor.view.panY + dy },
      stage,
    );
    editor.flashScaleMenu();
  }

  /** Which way the pointer lies from the middle of the table, degrees. */
  function aroundTable(e: { clientX: number; clientY: number }): number {
    const rect = canvasRect();
    return (Math.atan2(e.clientY - rect.top - rect.height / 2, e.clientX - rect.left - rect.width / 2) * 180) / Math.PI;
  }

  /** Turns the sheet to `angle` about a point of the screen. */
  function turnTo(angle: number, clientX: number, clientY: number): void {
    const rect = canvasRect();
    editor.view = rotateAt(editor.view, angle, clientX - rect.left, clientY - rect.top, stage);
    editor.flashScaleMenu();
  }

  function zoomTo(zoom: number, clientX: number, clientY: number): void {
    const rect = canvasRect();
    // Unsnapped: the notches are for the keys, not for fingers or the wheel.
    editor.view = zoomAt(editor.view, zoom, clientX - rect.left, clientY - rect.top, stage, false);
  }

  /** When the last trackpad scroll came (`e.timeStamp`), for `trackpadScroll`'s streak. */
  let trackpadAt = -Infinity;

  /**
   * Wheel zooms the sheet softly under the cursor, a tenth a notch, gliding
   * to it (owner, 2026-10-11). Ctrl+wheel — a trackpad or tablet pinch among
   * them — glides the same at the pinch's rate, and keeps the page from zooming. Two
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
    const pinch = e.ctrlKey || e.metaKey;
    if (!pinch && trackpadScroll(e, e.timeStamp - trackpadAt < WHEEL_ZOOM_IDLE_MS)) {
      trackpadAt = e.timeStamp;
      // A stream: the grabbed picture slides, composed once it stops.
      takeNavShot();
      clearTimeout(wheelZoomTimer);
      wheelZoomTimer = setTimeout(endWheelZoom, WHEEL_ZOOM_IDLE_MS) as unknown as number;
      panBy(-e.deltaX, -e.deltaY);
      return;
    }
    // A stream too, a spin of the wheel or a pinch (which arrives as Ctrl+wheel):
    // it moves the picture it grabbed and composes afresh once it stops.
    takeNavShot();
    clearTimeout(wheelZoomTimer);
    wheelZoomTimer = setTimeout(endWheelZoom, WHEEL_ZOOM_IDLE_MS) as unknown as number;
    // Notches add up on the goal, not on wherever the glide has got to. The
    // pinch glides as well: a graphics tablet sends it in a few coarse steps.
    const from = glideRaf ? glideGoal : editor.view.zoom;
    const rate = pinch ? WHEEL_ZOOM_RATE : WHEEL_SOFT_RATE;
    glideTo(ctrlWheelZoom(from, e.deltaY, e.deltaMode, rate), e.clientX, e.clientY);
    editor.flashScaleMenu();
  }

  /** Where the wheel's zoom is gliding to, around which point, and the zoom its last frame left. */
  let glideGoal = 1;
  let glideX = 0;
  let glideY = 0;
  let glideAt = 1;
  let glideTime = 0;
  /** The glide's pending frame; 0 when none is running. */
  let glideRaf = 0;

  /** The wheel's zoom arrives over a few frames instead of a jump — at once for those who asked for less motion. */
  function glideTo(zoom: number, clientX: number, clientY: number): void {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      zoomTo(zoom, clientX, clientY);
      return;
    }
    glideGoal = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
    glideX = clientX;
    glideY = clientY;
    if (!glideRaf) {
      glideAt = editor.view.zoom;
      glideTime = performance.now();
      glideRaf = requestAnimationFrame(glideFrame);
    }
  }

  function glideFrame(now: number): void {
    glideRaf = 0;
    // A pinch, a key or a reset took the zoom, or a line began: theirs now.
    if (destroyed || drawingBusy() || editor.view.zoom !== glideAt) {
      return;
    }
    zoomTo(easeZoom(glideAt, glideGoal, now - glideTime), glideX, glideY);
    glideAt = editor.view.zoom;
    glideTime = now;
    if (glideAt !== glideGoal) {
      // The grabbed picture is held until the glide is over, not the wheel.
      clearTimeout(wheelZoomTimer);
      wheelZoomTimer = setTimeout(endWheelZoom, WHEEL_ZOOM_IDLE_MS) as unknown as number;
      glideRaf = requestAnimationFrame(glideFrame);
    }
  }

  /** How long a Ctrl+wheel stream may pause before it counts as over, ms. */
  const WHEEL_ZOOM_IDLE_MS = 150;
  /** Pending end of a Ctrl+wheel stream; 0 when none is running. */
  let wheelZoomTimer = 0;

  function endWheelZoom(): void {
    if (!wheelZoomTimer) {
      return;
    }
    clearTimeout(wheelZoomTimer);
    wheelZoomTimer = 0;
    if (!navigating()) {
      dropNavShot();
    }
  }

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
    takeNavShot();
    clearTimeout(wheelZoomTimer);
    wheelZoomTimer = setTimeout(endWheelZoom, WHEEL_ZOOM_IDLE_MS) as unknown as number;
    zoomTo(
      gestureZoom * scale,
      Number.isFinite(clientX) ? clientX! : rect.left + rect.width / 2,
      Number.isFinite(clientY) ? clientY! : rect.top + rect.height / 2,
    );
    editor.flashScaleMenu();
  }

  function onGestureEnd(e: Event): void {
    e.preventDefault();
    endWheelZoom();
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
    navShot = null;
    lastDrawn = null;
    lastRaster = null;
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
    return pointer.session !== null || grab !== null || megaGesture !== null || loopGesture !== null || pluginGrab !== null
      || shapeGesture !== null || rulerGrab !== null || magnetHeld || sizing !== null;
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

  // Shift and Alt pressed or let go mid-drag, the pointer still: the shape
  // follows them at once. Alt is kept from the browser's menu meanwhile.
  $effect(() => {
    const modifiers = (e: KeyboardEvent) => {
      if (!shapeGesture || (e.key !== 'Shift' && e.key !== 'Alt')) return;
      if (e.key === 'Alt') e.preventDefault();
      shapeGesture = { ...shapeGesture, square: e.shiftKey, fromCentre: e.altKey };
      scheduleDraw();
    };
    window.addEventListener('keydown', modifiers, { capture: true });
    window.addEventListener('keyup', modifiers, { capture: true });
    return () => {
      window.removeEventListener('keydown', modifiers, { capture: true });
      window.removeEventListener('keyup', modifiers, { capture: true });
    };
  });

  // A ruler laid afresh goes across the part of the sheet in view: only the
  // canvas knows which part that is.
  $effect(() => {
    editor.rulerPlacer = () => {
      const rect = canvasRect();
      const corners = [[rect.left, rect.top], [rect.right, rect.top], [rect.right, rect.bottom], [rect.left, rect.bottom]]
        .map(([clientX, clientY]) => toDocUnits({ clientX, clientY }, rect));
      const xs = corners.map(([x]) => x);
      const ys = corners.map(([, y]) => y);
      return rulerAcross(
        { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) },
        editor.doc.width,
        editor.doc.height,
      );
    };
    return () => {
      editor.rulerPlacer = null;
    };
  });

  /** The finger that touched a running preview: lifted alone, it stops it. */
  let stopOnLift: number | null = null;
  /** The first move of the pen with no buttons in a gesture still open — where it left, if it did. */
  let penLift: PointerEvent | null = null;
  function onPointerDown(e: PointerEvent): void {
    // The pen pressed again: its release was lost after all, and the gesture
    // ends where the buttons went, not across the sheet at the new press.
    if (penLift) onPointerUp(penLift);
    // A second finger makes it a gesture: the film runs on under a moved sheet.
    if (!e.isPrimary) stopOnLift = null;
    sideButtons.press(e.button);
    if (e.isPrimary) {
      press = { event: e, far: false };
    }
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
    // A press right after a trackpad pinch draws on the picture as it is now,
    // not on the moved shot of it.
    endWheelZoom();
    // A press on a running preview stops it and draws nothing (owner,
    // 2026-10-13: the stroke was dropped without a word) — as a tap that
    // closes a window only closes it.
    if (editor.playing && e.isPrimary) {
      if (e.pointerType === 'touch') stopOnLift = e.pointerId;
      else editor.stopPreview?.();
      return;
    }
    if (editor.playing || !e.isPrimary || pointer.session) {
      return;
    }
    rulerLock = null;
    // The ruler is taken by any tool but the hand, which moves the sheet: its
    // body moves it, an end turns it, and the strip by an edge lays a line
    // along it (below). A live transform keeps the canvas to itself.
    const rulerHit = editor.tool !== 'drag' && !editor.transform ? rulerHitAt(e) : null;
    if (rulerHit && rulerHit.part !== 'edge' && shownRuler) {
      rulerGrab = { pointerId: e.pointerId, base: shownRuler, from: toDocUnits(e), end: rulerHit.part === 'end' ? rulerHit.end : null };
      rulerLive = shownRuler;
      capturePointer(e.pointerId);
      // The canvas's own gesture: a cancel or a lost capture drops it
      // (dropOwnGesture), and a palm by the pen dragging it is a palm.
      gesturePointerId = e.pointerId;
      return;
    }
    // Shift+drag sizes the brush wherever its ring is the cursor (Krita; the
    // owner: settings are a gesture in the editor). The mouse button or the
    // pen tip; a finger never, it has no Shift. No dot, no stroke.
    if (e.shiftKey && e.button === 0 && e.pointerType !== 'touch' && !editor.transform
      && editor.tool !== 'pipette' && !overlayCursor) {
      const size = editor.brushSizeLogical;
      sizing = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, start: size, size, magnet };
      capturePointer(e.pointerId);
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
        capturePointer(e.pointerId);
        return;
      }
    }
    // The lasso proper: a press that took nothing of an open selection begins
    // the next loop, and that selection is applied first — or, locked, kept.
    if (editor.tool === 'loop') {
      if (editor.mayEdit() && editor.leaveTransform()) {
        const [x, y] = toDocUnits(e);
        loopGesture = [Math.round(x), Math.round(y)];
        capturePointer(e.pointerId);
        gesturePointerId = e.pointerId;
      }
      return;
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
      capturePointer(e.pointerId);
      gesturePointerId = e.pointerId;
      return;
    }
    // The magnet takes the points under its circle on every selected visible
    // layer and carries them until let go; one step of undo (tools/magnet.ts).
    if (editor.tool === 'magnet') {
      if (editor.beginMagnet(toDocUnits(e))) {
        magnetHeld = true;
        capturePointer(e.pointerId);
        gesturePointerId = e.pointerId;
      }
      return;
    }
    // The shapes tool frames its shape by the drag and lays it on release.
    // Shift held at the press already went to the brush size, above.
    if (editor.tool === 'shapes') {
      if (editor.mayEdit()) {
        const [x, y] = toDocUnits(e);
        shapeGesture = {
          pointerId: e.pointerId,
          a: [x, y],
          b: [x, y],
          square: false,
          fromCentre: false,
          swap: e.button === 2,
          touch: e.pointerType === 'touch',
          second: null,
          layer: editor.doc.layers[editor.activeLayer],
          cell: markActive(),
        };
        capturePointer(e.pointerId);
        gesturePointerId = e.pointerId;
      }
      return;
    }
    if (editor.tool === 'bucket') {
      // The table beside the sheet is nobody's area.
      if (!offSheet(e) && editor.mayEdit()) {
        pour(e);
      }
      return;
    }
    if (editor.tool === 'pipette') {
      // A finger hides the spot it presses: under it the pipette shows what
      // it would take in the loupe over the finger, follows it, and takes
      // when the finger lifts (owner, 2026-10-13).
      if (e.pointerType === 'touch') {
        try {
          capturePointer(e.pointerId);
        } catch {
          // The finger left in the same tick; its pointerup ends nothing.
        }
        dropper = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, color: null, off: false, tool: true };
        aimDropper(e);
        scheduleDraw();
        return;
      }
      // The table beside the sheet holds no colour and no emptiness to erase:
      // a press that missed the sheet takes nothing, and the tool stays.
      if (offSheet(e)) {
        return;
      }
      // Right button takes the fill color (reference: ЛКМ — контур, ПКМ — заливка);
      // the palette's pipette can arm the fill for the left button too.
      const toFill = e.button === 2 || editor.pipetteTarget === 'fill';
      if (takeColour(e, toFill) !== null && e.button !== 2) {
        // A primary pick finishes the pipette for either swatch.
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
      megaAt = { layer: editor.doc.layers[editor.activeLayer], cell: markActive() };
      capturePointer(e.pointerId);
      gesturePointerId = e.pointerId;
      scheduleDraw();
      return;
    }
    // Nothing would appear — the state says so instead of swallowing the gesture.
    if (!editor.mayEdit()) {
      return;
    }
    strokeLayer = editor.doc.layers[editor.activeLayer];
    strokeCell = markActive();
    // The eraser end (5) is the eraser itself, not a second button's colour.
    strokeButton = e.button === 5 ? 0 : e.button;
    if (rulerHit?.part === 'edge' && shownRuler) {
      rulerLock = { pointerId: e.pointerId, lay: alongRuler(shownRuler, toDocUnits(e)) };
    }
    (captureStageEl ?? canvasEl).setPointerCapture(e.pointerId);
    pointer.pointerDown(toPointerSample(e, true));
    scheduleDraw();
  }

  function onPointerMove(e: PointerEvent): void {
    // A second button pressed while the first is held comes as a move, not a
    // pointerdown: a thumb on «back» in the middle of a line left the studio.
    sideButtons.press(e.button);
    if (press && !press.far && e.pointerId === press.event.pointerId) {
      press.far = pastDragThreshold(e.clientX - press.event.clientX, e.clientY - press.event.clientY, e.pointerType);
    }
    // A mouse or a pen moving with no button held has let go somewhere the
    // canvas did not hear (a native dialog, the window losing focus): end the
    // gesture here, or the stroke follows the hover and refuses the next press.
    // A finger has no hover — its moves are always pressed.
    if (e.pointerType !== 'touch' && e.buttons === 0
      && (pointer.session || grab || megaGesture || shapeGesture || rulerGrab || loopGesture || pluginGrab || magnetHeld || panning || sizing)) {
      // Firefox on Windows sends a Wacom pen's light line one move with no
      // buttons while the tip stays down: the line goes on. Whether the pen
      // really left is told by its next press (onPointerDown).
      if (e.pointerType === 'pen') {
        penLift ??= e;
        return;
      }
      onPointerUp(e);
      return;
    }
    if (e.pointerType === 'pen') penLift = null;
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
      const turn = panning.turn;
      if (turn) {
        const dir = aroundTable(e);
        const twisted = turn.twisted + wrapAngle(dir - turn.dir);
        turnTo(snapAngle(turn.angle + twisted), rect.left + rect.width / 2, rect.top + rect.height / 2);
        panning = { ...panning, turn: { ...turn, dir, twisted } };
        return;
      }
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
    if (rulerGrab && e.pointerId === rulerGrab.pointerId) {
      const at = toDocUnits(e, rect);
      rulerLive = rulerGrab.end === null
        ? movedRuler(rulerGrab.base, rulerGrab.from, at)
        : turnedRuler(rulerGrab.base, rulerGrab.end, at, e.shiftKey ? 'step' : e.pointerType === 'touch' ? 'pull' : 'free', unitsPerPx());
      return;
    }
    // Over the ruler with nothing held, the cursor says what a press would do.
    if (e.buttons === 0 && !pointer.session) {
      const part = editor.tool !== 'drag' ? rulerHitAt(e, rect)?.part ?? null : null;
      if (part !== rulerHover) rulerHover = part;
    }
    if (shapeGesture && e.pointerId === shapeGesture.pointerId) {
      shapeGesture = { ...shapeGesture, b: toDocUnits(e, rect), square: e.shiftKey, fromCentre: e.altKey };
      scheduleDraw();
      return;
    }
    if (loopGesture && e.pointerId === gesturePointerId) {
      const [x, y] = toDocUnits(e, rect);
      loopGesture.push(Math.round(x), Math.round(y));
      return;
    }
    if (magnetHeld && e.pointerId === gesturePointerId) {
      editor.dragMagnet(toDocUnits(e, rect));
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
        // The twist is summed over the whole gesture and measured from the
        // angle it began at: the slop is taken off once, and a magnet lets go.
        const twisted = gesture.twisted + wrapAngle(next.dir - gesture.dir);
        const slack = gesture.slack ?? (Math.abs(twisted) > TWIST_SLOP ? Math.sign(twisted) * TWIST_SLOP : null);
        if (slack !== null) {
          turnTo(snapAngle(gesture.angle + twisted - slack), next.midX, next.midY);
        }
        panBy(next.midX - gesture.midX, next.midY - gesture.midY);
        // What the view took, clamp and all: past 10× the fingers coming back
        // together answer at once instead of unwinding a zoom nobody sees.
        gesture = { ...next, zoom: editor.view.zoom, angle: gesture.angle, twisted, slack };
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

  /** Whether the hand is moving the picture right now — pan, two fingers, or a trackpad pinch. */
  function navigating(): boolean {
    return panning !== null || gesture !== null || wheelZoomTimer !== 0;
  }

  /** Fingers let go of the sheet at once: the picture is composed again, once. */
  function stopTouchNavigation(): void {
    if (!gesture && !(panning && touches.has(panning.pointerId))) {
      return;
    }
    gesture = null;
    panning = null;
    dropNavShot();
  }

  function dropNavShot(): void {
    navShot = null;
    if (shotCanvas) {
      shotCanvas.width = 0;
    }
    scheduleDraw();
  }

  function endNavigation(e: PointerEvent): boolean {
    // The shape's second finger lifted (or lost): the shape follows the first again.
    if (shapeGesture?.second === e.pointerId) {
      shapeGesture = { ...shapeGesture, second: null };
      scheduleDraw();
      return true;
    }
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
    // The gesture showed the frame it grabbed; standing still, the picture is
    // composed again, once, for the view it came to rest in. The shot's
    // backing store goes back too — a stage of pixels held for nothing.
    if (was && !navigating()) {
      dropNavShot();
      return true;
    }
    return false;
  }

  function onPointerUp(e: PointerEvent): void {
    penLift = null;
    if (stopOnLift === e.pointerId) {
      stopOnLift = null;
      editor.stopPreview?.();
    }
    // Once whatever this ends has let go of the sheet.
    queueMicrotask(settleCovers);
    if (hold?.pointerId === e.pointerId) {
      cancelHold();
    }
    if (endNavigation(e)) {
      return;
    }
    if (dropper && e.pointerId === dropper.pointerId) {
      if (dropper.tool) liftPipette(e);
      else finishDropper(e);
      return;
    }
    if (sizing && e.pointerId === sizing.pointerId) {
      // Through the slider's own setter: clamped, saved to the brush record —
      // or, with the magnet in hand, to its radius.
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
    if (magnetHeld && e.pointerId === gesturePointerId) {
      releaseMagnet();
      return;
    }
    if (loopGesture && e.pointerId === gesturePointerId) {
      const loop = loopGesture;
      loopGesture = null;
      gesturePointerId = -1;
      // A tap closes no loop, and says nothing of an empty one.
      if (loop.length >= 6 && !onlyDismissed(e)) {
        editor.beginLassoTransform(loop);
      }
      return;
    }
    if (rulerGrab && e.pointerId === rulerGrab.pointerId) {
      if (rulerLive) editor.placeRuler(rulerLive);
      rulerGrab = null;
      rulerLive = null;
      gesturePointerId = -1;
      return;
    }
    if (shapeGesture && e.pointerId === shapeGesture.pointerId) {
      const drag = { ...shapeGesture, b: toDocUnits(e), square: e.shiftKey, fromCentre: e.altKey };
      shapeGesture = null;
      gesturePointerId = -1;
      // A click lays nothing: a shape is a drag, past the threshold of one.
      const stroke = press?.far ? shapeNow(drag) : null;
      const layer = drag.layer ? editor.doc.layers.indexOf(drag.layer) : -1;
      const frame = frameOfMark(layer, drag.cell);
      if (stroke && layer >= 0 && frame >= 0) {
        try {
          editor.commitStroke(layer, stroke, frame);
        } catch (err) {
          reportError(err);
        }
      }
      scheduleDraw();
      return;
    }
    if (megaGesture && e.pointerId === gesturePointerId) {
      // The tap that put a popup away erases nothing either.
      if (onlyDismissed(e)) {
        megaGesture = null;
        gesturePointerId = -1;
        scheduleDraw();
        return;
      }
      const layer = megaAt.layer ? editor.doc.layers.indexOf(megaAt.layer) : -1;
      const frame = megaAt.cell ? frameOfMark(layer, megaAt.cell) : -1;
      editor.applyMegaEraser(megaGesture, brushWidthDoc(editor.brushSizeLogical) / 2, layer, frame);
      megaGesture = null;
      gesturePointerId = -1;
      composer.invalidate();
      glComposer?.invalidate();
      scheduleDraw();
      return;
    }
    if (!pointer.session || !e.isPrimary) {
      return;
    }
    // A tap that closed a popup only closed it: its dot goes, unrecorded. A
    // stroke begun by such a press has travelled, and is drawn whole.
    if (onlyDismissed(e)) {
      pointer.discard();
      strokeLayer = undefined;
      scheduleDraw();
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
    const frame = strokeCell ? frameOfMark(index, strokeCell) : -1;
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
    stopOnLift = null;
    penLift = null;
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
    // Begun beside the ruler's edge, the line runs along it: every sample,
    // the held-back ones too, goes onto the line through the press.
    const lay = rulerLock?.pointerId === e.pointerId ? rulerLock.lay : null;
    const place = (point: [number, number]): [number, number] => (lay ? lay(point) : point);
    const [x, y] = place(toDocUnits(e, rect));
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
          const [sampleX, sampleY] = place(toDocUnits(sample, rect));
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
  <!-- Permanent pointer-capture stage container: the Canvas 2D and WebGL2
       surfaces sit inside it as non-interactive siblings so backend switches
       and context loss never interrupt an active stroke or lasso drag. -->
  <div
    class="stage"
    bind:this={captureStageEl}
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
    class:custom-cursor={!editor.playing && editor.tool !== 'pipette' && (!overlayCursor || crossOnly)}
    class:playing={editor.playing}
    style:cursor={(!editor.playing && rulerHover === 'body' && 'move') || (!editor.playing && rulerHover === 'end' && 'grab')
      || (!editor.playing && !crossOnly && overlayCursor) || null}
  >
    <canvas
      bind:this={canvasEl}
      class="surface"
      class:hidden={webglVisible}
      aria-hidden="true"
    ></canvas>
    {#key glMountKey}
      <canvas
        bind:this={glCanvasEl}
        class="surface"
        class:hidden={!webglVisible}
        aria-hidden="true"
      ></canvas>
    {/key}
  </div>
  {#if rulerShape}
    <!-- The ruler: a band on the sheet, the studio's alone. Purely visual too:
         its presses are read off the canvas (rulerHitAt). -->
    <svg class="overlay ruler" aria-hidden="true">
      <polygon class="ruler-band" points={rulerShape.band} />
      <path class="ruler-ticks" d={rulerShape.ticks} />
    </svg>
  {/if}
  <!-- Selection chrome. Purely visual: every gesture is read off the canvas
       itself, so pointer capture, touch and the keyboard path stay intact. -->
  {#if displayedHandles}
    <svg
      class="overlay"
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
  {#if loopGesture}
    <svg
      class="overlay"
      aria-hidden="true"
    >
      <polygon class="frame" points={screenPoints(loopGesture)} />
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
    {#if !('bare' in ring)}
    <span
      class="size-number"
      style:transform="translate({ring.x}px, {ring.y}px) translate(-50%, calc(-100% - 12px))"
      aria-hidden="true"
    >{ring.magnet ? t('magnet.radius_title', { size: ring.size / 2 }) : t('brush.size_title', { size: ring.size })}</span>
    {/if}
  {/if}
  <!-- The thickness for a finger (Procreate Dreams' sidebar): on the stage,
       not in a column, so it stays whatever the panels around it do. Through
       the preview it stays as the fps slider does, aria-disabled: gone, it
       dropped the focus on it to <body> (owner, after the seventeenth audit). -->
  {#if rail}
  <div
    class="size-rail"
    data-over-sheet="side"
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
  {/if}
  {#if cursorVisible && crossOnly && !ring && !dropper}
    <span
      class="brush-cursor cross ringless"
      style:transform="translate({cursorX}px, {cursorY}px) translate(-50%, -50%)"
      aria-hidden="true"
    ></span>
  {:else if cursorVisible && !editor.playing && editor.tool !== 'pipette' && !overlayCursor && !ring && !dropper}
    <span
      class="brush-cursor"
      class:eraser={editor.tool === 'eraser' || editor.tool === 'mega-eraser'}
      class:cross={cursorParts.cross}
      class:ringless={!cursorParts.ring}
      class:square={toolSpec(editor.brushTool)?.stroke?.grid}
      style:transform="translate({cursorX}px, {cursorY}px) translate(-50%, -50%){toolSpec(editor.brushTool)?.stroke?.grid ? ` rotate(${editor.view.angle}deg)` : ''}"
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
    /* The table runs on under what floats beside the stage — the columns and
       the bar below (Editor sets `--stage-left`, `--stage-right` and
       `--stage-under` to what each takes): the sheet shows around a card
       instead of being cut off at a line beside it. */
    width: calc(100% + var(--stage-left, 0px) + var(--stage-right, 0px));
    margin-left: calc(-1 * var(--stage-left, 0px));
    height: calc(100% + var(--stage-under, 0px));
    background: var(--table);
    display: flex;
    align-items: center;
    justify-content: center;
    /* A finger held still is the pipette (hold-pick.ts): iOS took the same
       hold for a text selection and its callout. */
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }
  .stage {
    position: relative;
    display: block;
    background: transparent;
    /* Page scroll/zoom must not hijack drawing. */
    touch-action: none;
    cursor: crosshair;
  }
  .stage.custom-cursor {
    cursor: none;
  }
  /* Through the preview a press does nothing: no ring, no swatch, no cross
     promising otherwise — the system's own arrow. */
  .stage.playing {
    cursor: default;
  }
  .surface {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    background: transparent;
    pointer-events: none;
  }
  .surface.hidden {
    visibility: hidden;
  }
  .overlay {
    position: absolute;
    /* The canvas fills the wrap; the overlay sits exactly on it. */
    left: 0;
    top: 0;
    /* The wrap's own box, not its measured size: that is a whole number, and
       over a wrap half a pixel shorter the overlay stuck out of the page —
       a scrollbar came with the first handle or loop. One unit is one CSS
       pixel with no viewBox, which is what `toScreen` counts in. */
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .ruler-band {
    /* See-through, so the line it guides shows under it. */
    fill: var(--canvas);
    fill-opacity: 0.7;
    stroke: var(--ink-2);
    stroke-width: 1;
  }
  .ruler-ticks {
    fill: none;
    stroke: var(--ink-2);
    stroke-width: 1;
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
    will-change: transform;
    contain: layout style;
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
  /* 25 px arms, so a thin brush is found at a glance (owner, 2026-11-15). */
  .brush-cursor.cross::before {
    width: 25px;
    height: 1px;
  }
  .brush-cursor.cross::after {
    width: 1px;
    height: 25px;
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
       rail stood twice as far in behind a notch. Past the column the canvas
       runs on under (`--stage-left`): on a desk under a finger the rail
       stood under the tools' card (owner, 2026-10-12). */
    left: calc(var(--stage-left, 0px) + 1.25rem);
    /* Up to 16rem in the middle of the stage; a short landscape stage keeps
       its foot clear of the zoom bar in the corner below (4.5rem). */
    /* Of the stage that shows: the wrap runs on under the bottom panel
       (`--stage-under`), and counted whole the rail's foot stood under a
       phone's desk (Toonio, 390×844). */
    top: max(0.75rem, (100% - var(--stage-under, 0px)) / 2 - 8rem);
    bottom: calc(var(--stage-under, 0px) + max(4.5rem, (100% - var(--stage-under, 0px)) / 2 - 8rem));
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
    will-change: transform;
    contain: layout style;
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
      animation: loupe-in var(--dur-fast) var(--ease-out);
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
    /* The wrap runs on under the bottom bar (`--stage-under`): 12px from its
       own foot, the pill lay under the bar, its words cut by the strip. */
    bottom: calc(12px + var(--stage-under, 0px));
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
