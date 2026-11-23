/**
 * Studio sheet-composer contract shared by the Canvas 2D reference composer
 * (`FrameComposer`) and the hardware WebGL2 composer (`WebGL2SheetComposer`).
 *
 * Keeps presentation, committed-pixel sampling (pipette), invalidation, and
 * lifecycle disposal behind one seam so `CanvasView.svelte` and `bench/run.ts`
 * can swap backends cleanly without branching on Canvas 2D internals.
 */

import type { ToolDescriptor } from '../format/types';
import type { BlitTarget, Canvas2DLike, LayerLook } from './canvas2d';
import type { CellCache } from './cell-cache';
import {
  CELL_CACHE_BYTES,
  FrameComposer,
  type ComposeTarget,
  type FrameScene,
} from './frame-compose';

/** Geometry of the paper sheet placed on the studio display stage (in stage device px). */
export interface StagePresentParams {
  readonly stageWidth: number;
  readonly stageHeight: number;
  /** Sheet top-left X in stage device pixels. */
  readonly sheetX: number;
  /** Sheet top-left Y in stage device pixels. */
  readonly sheetY: number;
  /** Displayed sheet width in stage device pixels. */
  readonly sheetW: number;
  /** Displayed sheet height in stage device pixels. */
  readonly sheetH: number;
  /** Rotation angle in degrees about (sheetX, sheetY). */
  readonly angle: number;
  /** Sheet bitmap pixels per CSS/device stretch (`perPixel / raster.level`). */
  readonly stretch: number;
  /** Paper background color (`#rrggbb`). */
  readonly paper: string;
  /** Pixel-grid step in stage device pixels when the pixel tool grid is active, else 0. */
  readonly gridStep: number;
}

/**
 * Committed-pixel readback request for the studio pipette (`pickColor`).
 * Coordinates `(px, py)` are integer sheet-bitmap pixels.
 */
export interface SamplePixelRequest {
  readonly px: number;
  readonly py: number;
  /** `'canvas'` flattens all visible layers with looks; `'layer'` reads active layer alone. */
  readonly source: 'canvas' | 'layer';
  /** When true, composites over `paper` before returning RGBA. */
  readonly onPaper: boolean;
  readonly paper: string;
}

/** Straight (unpremultiplied) 8-bit RGBA tuple `[r, g, b, a]` in `0..255`. */
export type StraightRgba = readonly [number, number, number, number];

/**
 * Declarative live-stroke payload carried on `LiveLine` so both Canvas 2D and
 * WebGL2 can render live previews without opaque Canvas2D closures.
 */
export type DeclarativeLiveStroke =
  | {
      readonly kind: 'raw-polyline';
      readonly points: readonly number[];
      readonly width: number;
      readonly color: string;
      readonly fill?: string;
      /** Brush opacity multiplier (`0..1`), ignored when painting an opaque flat-coat mask. */
      readonly alpha?: number;
    }
  | {
      readonly kind: 'resolved';
      readonly points: readonly number[];
      readonly tool: ToolDescriptor;
      readonly color: string;
      readonly pressure?: readonly number[];
      /** Multiplier applied when the stroke is not a `buildup: false` flat coat. */
      readonly alpha: number;
    };

/**
 * Common studio composer seam.
 *
 * Returns `false` from `composeAndPresent` when the backend cannot render this
 * scene (e.g. VRAM preflight failure, context lost, or OOM), signalling the
 * host to fall back immediately to Canvas 2D.
 */
export interface SheetComposer {
  readonly kind: 'canvas2d' | 'webgl2';
  /** Optional cell cache exposed for idle warming (Canvas 2D mode). */
  readonly cells?: CellCache;
  invalidate(): void;
  /** Composes `scene` at `(sheetWidth, sheetHeight)` and presents it onto the stage. */
  composeAndPresent(
    sheetWidth: number,
    sheetHeight: number,
    scene: FrameScene,
    present: StagePresentParams,
    /** Optional playback still key; when set, the composer caches/replays the composed sheet. */
    playbackKey?: { readonly doc: FrameScene['doc']; readonly key: number; readonly total: number },
  ): boolean;
  /** Samples one committed pixel as straight RGBA (no paper/onion/live unless `onPaper` is true). */
  samplePixel(req: SamplePixelRequest): StraightRgba | null;
  /** Drops cached playback stills (e.g. when playback stops). */
  clearPlayback(): void;
  /** Releases all owned GPU/canvas buffers immediately. */
  dispose(): void;
}

type Stage2DCtx = Canvas2DLike &
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

function ensureCanvasSize(canvas: HTMLCanvasElement | undefined, width: number, height: number): HTMLCanvasElement {
  const el = canvas ?? document.createElement('canvas');
  if (el.width !== width) el.width = width;
  if (el.height !== height) el.height = height;
  return el;
}

function setTurnedTransform(ctx: Stage2DCtx, k: number, angle: number, x: number, y: number): void {
  const a = (angle * Math.PI) / 180;
  ctx.setTransform(k * Math.cos(a), k * Math.sin(a), -k * Math.sin(a), k * Math.cos(a), x, y);
}

function drawCanvasPixelGrid(
  ctx: Stage2DCtx,
  sheetX: number,
  sheetY: number,
  sheetW: number,
  sheetH: number,
  step: number,
): void {
  if (step < 4) return;
  ctx.globalCompositeOperation = 'difference';
  ctx.strokeStyle = '#303030';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const crisp = (at: number, origin: number): number => Math.round(origin + at) + 0.5 - origin;
  for (let x = 0; x < sheetW; x += step) {
    ctx.moveTo(crisp(x, sheetX), 0);
    ctx.lineTo(crisp(x, sheetX), sheetH);
  }
  for (let y = 0; y < sheetH; y += step) {
    ctx.moveTo(0, crisp(y, sheetY));
    ctx.lineTo(sheetW, crisp(y, sheetY));
  }
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
}

export interface Canvas2DSheetComposerOptions {
  /** Existing `FrameComposer` to wrap (creates a new one when omitted). */
  readonly composer?: FrameComposer;
  readonly cellBytes?: number;
  /** Optional custom playback still hook (used by `CanvasView.svelte` to share `PlaybackFrames`). */
  readonly playback?: {
    get(doc: FrameScene['doc'], width: number, height: number, key: number): ImageBitmap | ImageData | undefined;
    keep(doc: FrameScene['doc'], width: number, height: number, key: number, total: number, sheetEl: HTMLCanvasElement, sheetCtx: Stage2DCtx): void;
    release(): void;
  };
}

/**
 * Canvas 2D reference adapter implementing the shared `SheetComposer` contract
 * over `FrameComposer`, with identical presentation, pixel-grid overlay, and
 * 1×1 committed-layer pipette sampling.
 */
export class Canvas2DSheetComposer implements SheetComposer {
  readonly kind = 'canvas2d' as const;
  readonly frameComposer: FrameComposer;
  readonly #getStageCanvas: () => HTMLCanvasElement | undefined;
  readonly #playback: Canvas2DSheetComposerOptions['playback'];

  #sheetEl: HTMLCanvasElement | undefined;
  #pickEl: HTMLCanvasElement | undefined;

  constructor(
    stageCanvas: HTMLCanvasElement | (() => HTMLCanvasElement | undefined),
    options: Canvas2DSheetComposerOptions = {},
  ) {
    this.#getStageCanvas = typeof stageCanvas === 'function' ? stageCanvas : () => stageCanvas;
    this.frameComposer = options.composer ?? new FrameComposer(undefined, { cellBytes: options.cellBytes ?? CELL_CACHE_BYTES });
    this.#playback = options.playback;
  }

  get cells(): CellCache | undefined {
    return this.frameComposer.cells;
  }

  invalidate(): void {
    this.frameComposer.invalidate();
  }

  clearPlayback(): void {
    this.#playback?.release();
  }

  composeAndPresent(
    sheetWidth: number,
    sheetHeight: number,
    scene: FrameScene,
    present: StagePresentParams,
    playbackKey?: { readonly doc: FrameScene['doc']; readonly key: number; readonly total: number },
  ): boolean {
    const stageEl = this.#getStageCanvas();
    if (!stageEl) return false;
    if (stageEl.width !== present.stageWidth) stageEl.width = present.stageWidth;
    if (stageEl.height !== present.stageHeight) stageEl.height = present.stageHeight;
    const ctx = stageEl.getContext('2d') as unknown as Stage2DCtx | null;
    if (!ctx) return false;

    this.#sheetEl = ensureCanvasSize(this.#sheetEl, sheetWidth, sheetHeight);
    const sheetCtx = this.#sheetEl.getContext('2d') as unknown as Stage2DCtx | null;
    if (!sheetCtx) return false;

    sheetCtx.setTransform(1, 0, 0, 1, 0, 0);
    sheetCtx.clearRect(0, 0, sheetWidth, sheetHeight);

    const kept = playbackKey
      ? this.#playback?.get(playbackKey.doc, sheetWidth, sheetHeight, playbackKey.key)
      : undefined;
    if (kept) {
      if ('close' in kept) {
        sheetCtx.drawImage(kept, 0, 0);
      } else {
        sheetCtx.putImageData(kept, 0, 0);
      }
    } else {
      this.frameComposer.compose(sheetCtx as unknown as ComposeTarget, sheetWidth, sheetHeight, scene);
      if (playbackKey) {
        this.#playback?.keep(playbackKey.doc, sheetWidth, sheetHeight, playbackKey.key, playbackKey.total, this.#sheetEl, sheetCtx);
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, present.stageWidth, present.stageHeight);
    setTurnedTransform(ctx, 1, present.angle, present.sheetX, present.sheetY);
    ctx.fillStyle = present.paper;
    ctx.fillRect(0, 0, present.sheetW, present.sheetH);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, present.sheetW, present.sheetH);
    ctx.clip();
    try {
      setTurnedTransform(ctx, present.stretch, present.angle, present.sheetX, present.sheetY);
      ctx.imageSmoothingEnabled = present.stretch < 2;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.#sheetEl, 0, 0);
      if (present.gridStep >= 4) {
        setTurnedTransform(ctx, 1, present.angle, present.sheetX, present.sheetY);
        drawCanvasPixelGrid(ctx, present.sheetX, present.sheetY, present.sheetW, present.sheetH, present.gridStep);
      }
    } finally {
      ctx.restore();
    }
    return true;
  }

  samplePixel(req: SamplePixelRequest): StraightRgba | null {
    const layers = this.frameComposer.layers;
    if (!layers) return null;
    const read = layers.active as unknown as HTMLCanvasElement;
    const px = Math.min(read.width - 1, Math.max(0, Math.floor(req.px)));
    const py = Math.min(read.height - 1, Math.max(0, Math.floor(req.py)));

    this.#pickEl = ensureCanvasSize(this.#pickEl, 1, 1);
    const pctx = this.#pickEl.getContext('2d', { willReadFrequently: true }) as unknown as Stage2DCtx | null;
    if (!pctx) return null;

    const lay = (image: CanvasImageSource, look?: LayerLook): void => {
      pctx.globalAlpha = (look?.opacity ?? 100) / 100;
      pctx.globalCompositeOperation = look?.blend ?? 'source-over';
      pctx.drawImage(image, -px, -py);
      pctx.globalAlpha = 1;
      pctx.globalCompositeOperation = 'source-over';
    };

    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.clearRect(0, 0, 1, 1);
    if (req.onPaper) {
      pctx.fillStyle = req.paper;
      pctx.fillRect(0, 0, 1, 1);
    }
    if (req.source === 'canvas') {
      for (const part of layers.below) lay(part.image, part.look);
      lay(layers.active, layers.activeLook);
      for (const part of layers.above) lay(part.image, part.look);
    } else {
      lay(layers.active);
    }
    const d = (pctx as unknown as CanvasRenderingContext2D).getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }

  dispose(): void {
    this.frameComposer.dispose();
    this.#playback?.release();
    for (const spare of [this.#sheetEl, this.#pickEl]) {
      if (spare) {
        spare.width = 0;
        spare.height = 0;
      }
    }
    this.#sheetEl = undefined;
    this.#pickEl = undefined;
  }
}
