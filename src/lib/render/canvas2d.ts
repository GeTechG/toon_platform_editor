/**
 * Canvas 2D implementation of FrameRenderer + live stroke preview.
 * The only place where editor code talks to the Canvas API.
 */

import { BACKGROUND_COLOR } from '../format/constants';
import type { Frame, ToonDocument, ToolDescriptor } from '../format/types';
import type { FrameRenderer, Viewport } from './contract';
import { emitSmoothedPath, type PathSink } from './smoothing';
import { interpolatePixelLine } from '../tools/pixel';
import {
  emitPathForTool,
  isContourTool,
  isEraserTool,
  isFilledLineTool,
  isStampTool,
  resolveTool,
} from './dispatch';

/**
 * Subset of CanvasRenderingContext2D used by the renderer.
 * A real context satisfies it structurally; tests plug in a
 * recording implementation.
 */
export interface Canvas2DLike extends PathSink {
  readonly canvas: { width: number; height: number };
  globalCompositeOperation: GlobalCompositeOperation;
  lineWidth: number;
  strokeStyle: string;
  fillStyle: string;
  lineCap: string;
  lineJoin: string;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number): void;
  beginPath(): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  stroke(): void;
  fill(): void;
}

/** Minimal target for blitting a cached layer (identity transform). */
export interface BlitTarget {
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number): void;
}

/** Copies a cached committed-frame layer onto the visible canvas 1:1. */
export function blitLayer(source: CanvasImageSource, target: BlitTarget): void {
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.drawImage(source, 0, 0);
}

/** A transparent off-screen buffer one layer is rasterized into before being blitted. */
export interface ScratchLayer {
  ctx: Canvas2DLike;
  image: CanvasImageSource;
}

export type ScratchFactory = (width: number, height: number) => ScratchLayer;

function domScratch(width: number, height: number): ScratchLayer {
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D context unavailable for the layer scratch buffer');
  }
  return { ctx: ctx as unknown as Canvas2DLike, image: canvas as unknown as CanvasImageSource };
}

/**
 * Renders a frame of the document as the composite of its visible layers,
 * bottom-up. Each layer is rasterized into a transparent scratch buffer, so an
 * eraser only cuts the alpha of its own layer, and blitted onto the target.
 * The renderer owns one scratch buffer, created lazily and reused.
 */
export class Canvas2DFrameRenderer implements FrameRenderer<Canvas2DLike> {
  readonly #createScratch: ScratchFactory;
  #scratch: ScratchLayer | undefined;
  #scratchSize = { width: 0, height: 0 };

  constructor(createScratch: ScratchFactory = domScratch) {
    this.#createScratch = createScratch;
  }

  render(doc: ToonDocument, frameIndex: number, target: Canvas2DLike, viewport: Viewport): void {
    clearToBackground(target, viewport.background);
    const cells: Frame[] = [];
    for (const layer of doc.layers) {
      const cell = layer.frames[frameIndex];
      if (!layer.hidden && cell) {
        cells.push(cell);
      }
    }
    // Nothing can bleed between layers when there is only one and it does not
    // erase — draw it straight into the target (identical result, no buffer).
    if (cells.length <= 1 && !cells.some((cell) => hasEraser(cell, doc.tools))) {
      if (cells.length === 1) {
        renderStrokesLayer(cells[0], doc.tools, target, viewport);
      } else {
        applyDocTransform(target, viewport);
      }
      return;
    }
    const { width, height } = target.canvas;
    const scratch = this.#ensureScratch(width, height);
    for (const cell of cells) {
      scratch.ctx.setTransform(1, 0, 0, 1, 0, 0);
      scratch.ctx.clearRect(0, 0, width, height);
      renderStrokesLayer(cell, doc.tools, scratch.ctx, viewport);
      blitLayer(scratch.image, target);
    }
  }

  #ensureScratch(width: number, height: number): ScratchLayer {
    if (!this.#scratch || this.#scratchSize.width !== width || this.#scratchSize.height !== height) {
      this.#scratch = this.#createScratch(width, height);
      this.#scratchSize = { width, height };
    }
    return this.#scratch;
  }
}

function hasEraser(frame: Frame, tools: readonly ToolDescriptor[]): boolean {
  return frame.strokes.some((stroke) => isEraserTool(resolveTool(tools, stroke)));
}

/**
 * Live preview of the stroke being drawn: raw polyline without
 * smoothing on top of the already-rendered frame. Points are in
 * document units (float, before quantization).
 */
export function renderRawPolyline(
  points: readonly number[],
  width: number,
  color: string,
  target: Canvas2DLike,
  viewport: Viewport,
  /** Interior paint of a filled tool (the feather), the way the commit fills it. */
  fill?: string,
): void {
  if (points.length < 2) {
    return;
  }
  applyDocTransform(target, viewport);
  drawStrokePath(target, points, width, color, false, fill);
}

/** Dialect-aware live preview for prepared profile geometry. */
export function renderResolvedPreview(
  points: readonly number[],
  tool: ToolDescriptor,
  color: string,
  target: Canvas2DLike,
  viewport: Viewport,
): void {
  if (points.length < 2) return;
  applyDocTransform(target, viewport);
  drawResolvedStroke(target, points, tool, color);
}

/**
 * Renders a frame's strokes onto a transparent layer (no background
 * clear) so it can be composited: the caller paints the background once
 * and stacks layers. `tint` overrides every stroke color — used for the
 * onion-skin neighbor layers, keeping tint at composition, not in the
 * frame data. Same stroke path as the FrameRenderer, minus the fill.
 * Eraser strokes (erase flag) erase the layer's alpha via
 * destination-out — tint does not apply to them.
 */
export function renderStrokesLayer(
  frame: Frame,
  tools: readonly ToolDescriptor[],
  target: Canvas2DLike,
  viewport: Viewport,
  tint?: string,
): void {
  applyDocTransform(target, viewport);
  for (const stroke of frame.strokes) {
    const tool = resolveTool(tools, stroke);
    const erase = isEraserTool(tool);
    if (erase) {
      target.globalCompositeOperation = 'destination-out';
    }
    drawResolvedStroke(target, stroke.points, tool, erase ? ERASE_PAINT : (tint ?? toolColor(tool)));
    if (erase) {
      target.globalCompositeOperation = 'source-over';
    }
  }
}

const UNIT_SQUARE: readonly number[] = [0, 0, 1, 0, 1, 1, 0, 1];

function isUnitSquare(shape: readonly number[]): boolean {
  return shape.length === UNIT_SQUARE.length && shape.every((value, i) => value === UNIT_SQUARE[i]);
}

function drawResolvedStroke(
  target: Canvas2DLike,
  points: readonly number[],
  tool: ToolDescriptor,
  color: string,
): void {
  if (isStampTool(tool)) {
    // Every stored point is a place the tool's polygon is stamped at, `width`
    // document units across, with the places a fast drag skipped filled in by
    // Bresenham between consecutive points — the capture side stores only what
    // the pointer actually visited. The square of the pixel tool is one such
    // polygon; a brush with another outline is the same code and other data,
    // which is why the player can draw a shape it has never heard of.
    //
    // ponytail: one path per mark, as the reference fills one rect per cell. A
    // long stroke at a small size is thousands of them — batch them into one
    // path and a single fill() if a profile ever blames this.
    target.fillStyle = color;
    // The square is the common case by far (it is the pixel tool), and the
    // reference fills exactly one rect per cell — so it keeps the fast path,
    // and only a shape that is not the unit square walks a path.
    const square = isUnitSquare(tool.shape);
    const stamp = (x: number, y: number): void => {
      if (square) {
        target.fillRect(x, y, tool.width, tool.width);
        return;
      }
      target.beginPath();
      target.moveTo(x + tool.shape[0] * tool.width, y + tool.shape[1] * tool.width);
      for (let i = 2; i < tool.shape.length; i += 2) {
        target.lineTo(x + tool.shape[i] * tool.width, y + tool.shape[i + 1] * tool.width);
      }
      target.lineTo(x + tool.shape[0] * tool.width, y + tool.shape[1] * tool.width);
      target.fill();
    };
    for (let i = 0; i < points.length; i += 2) {
      if (i >= 2) {
        const between = interpolatePixelLine(
          points[i - 2], points[i - 1], points[i], points[i + 1], tool.width,
        );
        for (let j = 0; j < between.length; j += 2) {
          stamp(between[j], between[j + 1]);
        }
      }
      stamp(points[i], points[i + 1]);
    }
    return;
  }
  target.beginPath();
  if (isContourTool(tool)) {
    // Oldschool contour: the thickness is in the geometry — fill it.
    target.fillStyle = color;
    emitPathForTool(points, tool, target);
    target.fill();
    return;
  }
  // Frame.addSpline: one point, or two equal ones, is a circle of the pen's radius.
  const dot = points.length === 2
    || (points.length === 4 && points[0] === points[2] && points[1] === points[3]);
  if (dot && tool.dialect === 'multator') {
    target.fillStyle = color;
    target.arc(points[0], points[1], tool.width / 2, 0, Math.PI * 2);
    target.fill();
    return;
  }
  // The feather fills its path with the second color before stroking it.
  const filled = isFilledLineTool(tool);
  if (filled) {
    target.fillStyle = tool.fill;
  }
  target.lineWidth = tool.width;
  target.strokeStyle = color;
  target.lineCap = 'round';
  target.lineJoin = 'round';
  emitPathForTool(points, tool, target);
  if (filled) {
    target.fill();
  }
  target.stroke();
}

/**
 * Erasers cut alpha through destination-out, so their color never reaches a
 * pixel — this placeholder exists only because the path API needs one. It is
 * deliberately not the background color: nothing paints the background over
 * a layer any more.
 */
const ERASE_PAINT = '#000000';

/** Paint color of a non-erasing tool. */
function toolColor(tool: ToolDescriptor): string {
  return tool.kind === 'pencil'
    || tool.kind === 'contour'
    || tool.kind === 'feather'
    || tool.kind === 'stamp'
    ? tool.color
    : ERASE_PAINT;
}

function clearToBackground(target: Canvas2DLike, background: string | null = BACKGROUND_COLOR): void {
  target.setTransform(1, 0, 0, 1, 0, 0);
  if (background === null) {
    target.clearRect(0, 0, target.canvas.width, target.canvas.height);
    return;
  }
  target.fillStyle = background;
  target.fillRect(0, 0, target.canvas.width, target.canvas.height);
}

/** Maps document units to device pixels: k = scale × dpr, offset by the pan. */
function applyDocTransform(target: Canvas2DLike, viewport: Viewport): void {
  const k = viewport.scale * viewport.dpr;
  target.setTransform(k, 0, 0, k, (viewport.panX ?? 0) * viewport.dpr, (viewport.panY ?? 0) * viewport.dpr);
}

function drawStrokePath(
  target: Canvas2DLike,
  points: readonly number[],
  width: number,
  color: string,
  smooth: boolean,
  fill?: string,
): void {
  target.beginPath();
  if (points.length === 2) {
    // A dot: circle with radius of half the stroke width.
    target.fillStyle = color;
    target.arc(points[0], points[1], width / 2, 0, Math.PI * 2);
    target.fill();
    return;
  }
  target.lineWidth = width;
  target.strokeStyle = color;
  target.lineCap = 'round';
  target.lineJoin = 'round';
  if (smooth) {
    emitSmoothedPath(points, target);
  } else {
    target.moveTo(points[0], points[1]);
    for (let i = 1; i < points.length / 2; i++) {
      target.lineTo(points[2 * i], points[2 * i + 1]);
    }
  }
  if (fill !== undefined) {
    target.fillStyle = fill;
    target.fill();
  }
  target.stroke();
}
