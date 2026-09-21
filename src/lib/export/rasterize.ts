/**
 * One rasterizer for every export format: GIF, video and PNG all get their
 * frames from here, so the target resolution, the background and the
 * watermark are parameters instead of three implementations that drift.
 *
 * ponytail: frames are rendered on the main thread and, for GIF, held as RGBA
 * until the worker takes them — 2560×1440 is ~14 MB a frame, so a long
 * animation at the top resolution is hundreds of MB. Upgrade path is the
 * reference's: an `OffscreenCanvas` in a worker, handing back `ImageBitmap`.
 * It needs `Canvas2DFrameRenderer` to be worker-portable first.
 */

import { BACKGROUND_COLOR, FIXED_POINT_SCALE } from '../format/constants';
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
  const scaled = (width * doc.height) / doc.width;
  return { width, height: Math.max(2, Math.round(scaled / 2) * 2) };
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

  constructor(doc: ToonDocument, { width, watermark, transparent }: RasterizeOptions = {}) {
    this.#doc = doc;
    this.size = exportSize(doc, width ?? logicalSize(doc).width);
    this.#scale = this.size.width / logicalSize(doc).width;
    this.#watermark = watermark ?? false;
    this.#viewport = rasterViewport(doc, this.size.width, transparent);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.size.width;
    this.canvas.height = this.size.height;
    const ctx = this.canvas.getContext('2d');
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
 * Every frame in playback order. Yields to the event loop between frames, so
 * the progress line moves and Cancel is heard.
 */
export async function rasterizeDocument(
  doc: ToonDocument,
  options: RasterizeDocumentOptions = {},
): Promise<RgbaFrameBuffer[]> {
  const { signal, onProgress, ...rest } = options;
  const raster = new FrameRasterizer(doc, rest);
  const total = frameCount(doc);
  const frames: RgbaFrameBuffer[] = [];
  for (let index = 0; index < total; index++) {
    throwIfAborted(signal);
    raster.draw(index);
    frames.push({ data: raster.pixels(), ...raster.size });
    onProgress?.(index + 1, total);
    await Promise.resolve();
  }
  return frames;
}

/** The rejection every export path speaks: `AbortError`, never a bare Error. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException(t('export.cancelled'), 'AbortError');
  }
}
