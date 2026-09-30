/**
 * One rasterizer for every export format: GIF, video and PNG all get their
 * frames from here, so the target resolution, the background and the
 * watermark are parameters instead of three implementations that drift.
 *
 * ponytail: frames are rendered on the main thread. Each one is handed over
 * and forgotten, so the memory is a frame rather than an animation; the CPU
 * is still the main thread's. Upgrade path is the reference's: an
 * `OffscreenCanvas` in a worker, handing back `ImageBitmap`. It needs
 * `Canvas2DFrameRenderer` to be worker-portable first.
 */

import { BACKGROUND_COLOR, EXPORT_WIDTHS, FIXED_POINT_SCALE } from '../format/constants';
import type { ToonDocument } from '../format/types';
import { frameCount } from '../model/operations';
import { Canvas2DFrameRenderer, type Canvas2DLike } from '../render/canvas2d';
import type { Viewport } from '../render/contract';
import { t } from '../i18n';

export const WATERMARK_TEXT = 'toonop';

/** Which half of an export the progress bar is showing. */
export type ExportStage = 'render' | 'encode';

/** Reference stamp: `renderer.js:129-155`. */
const WATERMARK_FONT_PX = 18;
const WATERMARK_OUTLINE_PX = 3;
const WATERMARK_PADDING_PX = 6;

export interface ExportSize {
  width: number;
  height: number;
}

/**
 * Target pixel size for an export width. The height follows the document's
 * own proportion — a 600×300 drawing is not letterboxed into 16:9 — and is
 * rounded to an even number, which H.264 requires.
 */
export function exportSize(doc: ToonDocument, width: number): ExportSize {
  const fitted = Math.min(width, widestExport(doc));
  return { width: fitted, height: heightFor(doc, fitted) };
}

/**
 * Safari refuses a canvas over 4096×4096 pixels of area — it draws nothing
 * and says nothing. A frame is never asked for bigger than that, whatever
 * the proportion a file or the API brought.
 */
export const CANVAS_MAX_AREA = 4096 * 4096;

/**
 * Chrome and Firefox refuse a canvas longer than this on either side, whatever
 * its area: a drawing of 8×4096 px fitted the area at 181×92672 and came out
 * blank. A proportion past it even at the narrowest frame (1 px wide and over
 * 32767 tall) stays unsatisfiable — ponytail: no frame narrower than 1 px.
 */
export const CANVAS_MAX_SIDE = 32767;

function heightFor(doc: ToonDocument, width: number): number {
  const scaled = (width * doc.height) / doc.width;
  return Math.max(2, Math.round(scaled / 2) * 2);
}

/**
 * The widest export whose frame still fits `CANVAS_MAX_AREA` and
 * `CANVAS_MAX_SIDE`, and even: H.264 takes no frame of an odd width.
 */
function widestExport(doc: ToonDocument): number {
  const byArea = Math.sqrt((CANVAS_MAX_AREA * doc.width) / doc.height);
  const bySide = (CANVAS_MAX_SIDE * doc.width) / doc.height;
  let width = Math.max(1, Math.floor(Math.min(byArea, bySide, CANVAS_MAX_SIDE)));
  width -= width > 2 ? width % 2 : 0;
  const fits = (w: number) => {
    const height = heightFor(doc, w);
    return w * height <= CANVAS_MAX_AREA && height <= CANVAS_MAX_SIDE;
  };
  while (width > 2 && !fits(width)) {
    width -= 2;
  }
  while (width > 1 && !fits(width)) {
    width--;
  }
  return width;
}

/**
 * The widths the export sheet offers for this document: the reference row
 * without those over the canvas limit. With none left — a needle of a
 * drawing — the largest width that fits stands in for the row.
 */
export function exportWidths(doc: ToonDocument): number[] {
  const widest = widestExport(doc);
  const fit = EXPORT_WIDTHS.filter((width) => width <= widest);
  return fit.length > 0 ? fit : [widest];
}

/** Logical canvas size of the document, in px. */
export function logicalSize(doc: ToonDocument): ExportSize {
  return {
    width: Math.max(1, Math.round(doc.width / FIXED_POINT_SCALE)),
    height: Math.max(1, Math.round(doc.height / FIXED_POINT_SCALE)),
  };
}

/** Viewport that maps the document onto an export of this width. */
export function rasterViewport(doc: ToonDocument, width: number, transparent = false): Viewport {
  return {
    scale: width / logicalSize(doc).width / FIXED_POINT_SCALE,
    dpr: 1,
    background: transparent ? null : BACKGROUND_COLOR,
  };
}

export interface WatermarkLayout {
  fontSize: number;
  lineWidth: number;
  /** Anchor of the text, right-aligned on the bottom baseline. */
  x: number;
  y: number;
}

/** Where and how big the corner stamp sits, in target pixels. */
export function watermarkLayout(width: number, height: number, scale: number): WatermarkLayout {
  return {
    fontSize: WATERMARK_FONT_PX * Math.max(1, scale),
    lineWidth: WATERMARK_OUTLINE_PX,
    x: width - WATERMARK_PADDING_PX,
    y: height - WATERMARK_PADDING_PX,
  };
}

/** Minimal context the stamp needs on top of the renderer's own. */
export interface TextTarget {
  font: string;
  textAlign: string;
  textBaseline: string;
  lineWidth: number;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  strokeText(text: string, x: number, y: number): void;
  fillText(text: string, x: number, y: number): void;
}

/**
 * Black text in a white outline, bottom right. Drawn in target pixels: the
 * frame renderer leaves its document-units transform on the context, and
 * under that the stamp would shrink to a smudge.
 */
export function stampWatermark(
  ctx: TextTarget,
  width: number,
  height: number,
  scale: number,
  text = WATERMARK_TEXT,
): void {
  const { fontSize, lineWidth, x, y } = watermarkLayout(width, height, scale);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#000000';
  ctx.fillText(text, x, y);
}

export interface RasterizeOptions {
  /** Export width in px; the height follows `exportSize`. */
  width?: number;
  watermark?: boolean;
  transparent?: boolean;
  /**
   * Every frame is read back with `getImageData` (GIF). Such a canvas asks for
   * `willReadFrequently`: without it Chrome draws on the GPU and pulls each
   * frame back out of video memory, twice per frame of the animation.
   */
  readBack?: boolean;
}

/**
 * A canvas the document's frames are drawn into at export resolution, with
 * the watermark already stamped. The caller decides what to do with each
 * frame: read pixels (GIF), encode it (video) or save it (PNG).
 */
export class FrameRasterizer {
  readonly canvas: HTMLCanvasElement;
  readonly size: ExportSize;
  readonly #ctx: CanvasRenderingContext2D;
  readonly #doc: ToonDocument;
  readonly #viewport: Viewport;
  readonly #renderer = new Canvas2DFrameRenderer();
  readonly #watermark: boolean;
  readonly #scale: number;

  constructor(doc: ToonDocument, { width, watermark, transparent, readBack }: RasterizeOptions = {}) {
    this.#doc = doc;
    this.size = exportSize(doc, width ?? logicalSize(doc).width);
    this.#scale = this.size.width / logicalSize(doc).width;
    this.#watermark = watermark ?? false;
    this.#viewport = rasterViewport(doc, this.size.width, transparent);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.size.width;
    this.canvas.height = this.size.height;
    const ctx = readBack ? this.canvas.getContext('2d', { willReadFrequently: true }) : this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('canvas 2d context unavailable');
    }
    this.#ctx = ctx;
  }

  /** Draws one frame, watermark included. */
  draw(index: number): void {
    this.#renderer.render(this.#doc, index, this.#ctx as unknown as Canvas2DLike, this.#viewport);
    if (this.#watermark) {
      stampWatermark(this.#ctx, this.size.width, this.size.height, this.#scale);
    }
  }

  /** The frame currently on the canvas, as RGBA bytes. */
  pixels(): ArrayBuffer {
    return this.#ctx.getImageData(0, 0, this.size.width, this.size.height).data.buffer as ArrayBuffer;
  }
}

export interface RgbaFrameBuffer {
  data: ArrayBuffer;
  width: number;
  height: number;
}

export interface RasterizeDocumentOptions extends RasterizeOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Every frame in playback order, one at a time. Yields to the event loop
 * between frames, so the progress line moves and Cancel is heard — and hands
 * each buffer to the caller rather than collecting them, so a long animation
 * at the top resolution costs one frame of memory instead of all of them.
 */
export async function* rasterizeFrames(
  doc: ToonDocument,
  options: RasterizeDocumentOptions = {},
): AsyncGenerator<RgbaFrameBuffer> {
  const { signal, onProgress, ...rest } = options;
  // Every frame here is read back as pixels.
  const raster = new FrameRasterizer(doc, { ...rest, readBack: true });
  const total = frameCount(doc);
  for (let index = 0; index < total; index++) {
    throwIfAborted(signal);
    raster.draw(index);
    yield { data: raster.pixels(), ...raster.size };
    onProgress?.(index + 1, total);
    await nextTask();
  }
}

/**
 * Steps aside for the page: it paints the progress and hears «Отменить». A
 * resolved promise does not — it is a microtask, run before either.
 */
export function nextTask(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return scheduler?.yield ? scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0));
}

/** The rejection every export path speaks: `AbortError`, never a bare Error. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException(t('export.cancelled'), 'AbortError');
  }
}
