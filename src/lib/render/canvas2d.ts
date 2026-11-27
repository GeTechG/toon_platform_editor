/**
 * Canvas 2D implementation of FrameRenderer + live stroke preview.
 * The only place where editor code talks to the Canvas API.
 */

import { resolveCell } from '../model/cells';
import { BACKGROUND_COLOR, FIXED_POINT_SCALE } from '../format/constants';
import { opacityOf } from '../format/types';
import type { BlendMode, Frame, RasterCel, ToonDocument, ToolDescriptor } from '../format/types';
import type { FrameRenderer, Viewport } from './contract';
import { emitGeometry, emitGeometryFrom, isDot, type PathSink } from './smoothing';
import type { StrokeGeometry } from './smoothing';
import { interpolatePixelLine } from '../tools/pixel';
import {
  emitPathForTool,
  isFlatPaint,
  extendsFlatRun,
  hasInteriorPaint,
  isContourTool,
  isEraserTool,
  isFilledLineTool,
  isStampTool,
  resolveTool,
} from './dispatch';
import { emitPressuredOutline, flattenPressured } from './pressure';
import { RoundTurnSink } from './curve-stroke';
import { PathKeeper, pathCost } from './path-keeper';
import { cellBudget } from './cell-cache';

/**
 * Subset of CanvasRenderingContext2D used by the renderer.
 * A real context satisfies it structurally; tests plug in a
 * recording implementation.
 */
export interface Canvas2DLike extends PathSink {
  /** A vector export sink can accept the same group without a bitmap. */
  withOpacityGroup?(alpha: number, draw: () => void): void;
  readonly canvas: { width: number; height: number };
  globalCompositeOperation: GlobalCompositeOperation;
  globalAlpha: number;
  lineWidth: number;
  strokeStyle: string;
  fillStyle: string;
  lineCap: string;
  lineJoin: string;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number, width: number, height: number): void;
  beginPath(): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  /** Without a path, the current one; with one, that path (stroke-path cache). */
  stroke(path?: Path2D): void;
  fill(path?: Path2D): void;
}

/** Minimal target for blitting a cached layer (identity transform). */
export interface BlitTarget {
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number): void;
}

/** A blit target that can lay a layer translucent or blended. */
export interface LookTarget {
  globalAlpha: number;
  globalCompositeOperation: GlobalCompositeOperation;
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
 * bottom-up, in a transparent buffer laid onto the target once. Layers that
 * erase nothing are drawn straight into that buffer; a layer that erases above
 * another is rasterized apart first, so its eraser only cuts its own alpha.
 * The renderer owns both buffers, created lazily and reused.
 */
export class Canvas2DFrameRenderer implements FrameRenderer<Canvas2DLike> {
  readonly #createScratch: ScratchFactory;
  /** The frame's buffer, then the one a layer that erases is rasterized in. */
  #scratch: ScratchLayer[] = [];
  #scratchSize = { width: 0, height: 0 };

  constructor(createScratch: ScratchFactory = domScratch) {
    this.#createScratch = createScratch;
  }

  render(doc: ToonDocument, frameIndex: number, target: Canvas2DLike, viewport: Viewport): void {
    clearToBackground(target, viewport.background);
    const cells: Frame[] = [];
    const looks: LayerLook[] = [];
    for (const layer of doc.layers) {
      // A continuation is drawn as the drawing it shows.
      const cell = layer.frames.length > frameIndex ? resolveCell(layer, frameIndex) : undefined;
      if (!layer.hidden && cell) {
        cells.push(cell);
        looks.push(layer);
      }
    }
    const mask = () => this.#cleared(2, target.canvas.width, target.canvas.height);
    // Nothing can bleed between layers when there is only one and it does not
    // erase — draw it straight into the target (identical result, no buffer).
    if (cells.length <= 1 && !cells.some((cell) => hasEraser(cell, doc.tools)) && !looks.some(hasLook)) {
      if (cells.length === 1) {
        renderStrokesLayer(cells[0], doc.tools, target, viewport, undefined, undefined, mask);
      } else {
        applyDocTransform(target, viewport);
      }
      return;
    }
    const { width, height } = target.canvas;
    // A blend mode is laid over the paper too: the stack is built on the
    // target the paper is on, not in a transparent buffer laid over it.
    if (viewport.background !== null && looks.some((look) => look.blend)) {
      renderLayersStacked(cells, doc.tools, target, viewport, () => this.#cleared(1, width, height), undefined, looks, true, mask);
      return;
    }
    const frame = this.#cleared(0, width, height);
    renderLayersStacked(cells, doc.tools, frame.ctx, viewport, () => this.#cleared(1, width, height), undefined, looks, false, mask);
    blitLayer(frame.image, target);
  }

  /** Large exports decode one crop at a time at the requested resolution. */
  async renderWithRaster(
    doc: ToonDocument,
    frameIndex: number,
    target: Canvas2DLike,
    viewport: Viewport,
    load: (cel: RasterCel) => Promise<ImageBitmap>,
  ): Promise<void> {
    clearToBackground(target, viewport.background);
    const { width, height } = target.canvas;
    const layers = doc.layers.filter((layer) => !layer.hidden && layer.opacity !== 0);
    const frame = viewport.background !== null && layers.some((layer) => layer.blend)
      ? undefined : this.#cleared(0, width, height);
    const into = frame?.ctx ?? target;
    const scratch = () => this.#cleared(1, width, height);
    const mask = () => this.#cleared(2, width, height);
    for (const layer of layers) {
      if (frameIndex >= layer.frames.length) continue;
      const cell = resolveCell(layer, frameIndex);
      if (cell.raster) {
        const image = await load(cell.raster);
        try {
          drawRasterCel(cell.raster, into, { ...viewport, raster: () => image }, layer);
        } finally {
          image.close();
        }
      } else {
        renderLayersStacked([cell], doc.tools, into, viewport, scratch, undefined, [layer], true, mask);
      }
    }
    if (frame) blitLayer(frame.image, target);
  }

  #cleared(slot: number, width: number, height: number): ScratchLayer {
    if (this.#scratchSize.width !== width || this.#scratchSize.height !== height) {
      this.#scratch = [];
      this.#scratchSize = { width, height };
    }
    const scratch = (this.#scratch[slot] ??= this.#createScratch(width, height));
    scratch.ctx.setTransform(1, 0, 0, 1, 0, 0);
    scratch.ctx.clearRect(0, 0, width, height);
    return scratch;
  }
}

/** What a layer looks like when it is laid: how strongly it shows and how it blends. */
export interface LayerLook {
  readonly opacity?: number;
  readonly blend?: BlendMode;
}

/** A layer that is not laid plainly: translucent, or with a blend mode. */
export function hasLook(look: LayerLook | undefined): boolean {
  return look !== undefined && (look.opacity !== undefined || look.blend !== undefined);
}

/**
 * Layers bottom-up onto a transparent target that holds nothing yet. A buffer
 * per layer was a clear and a blit of the whole sheet per layer — a third of a
 * frame of five layers rendered in software. Only a layer that erases needs
 * one, so its eraser cuts its own alpha alone, and not the bottom layer:
 * nothing is under it. A layer with a look needs one too, wherever it lies:
 * its alpha is the whole layer's, so its own lines do not darken where they
 * cross, and its mode is laid over what is under it. `apart` hands that
 * buffer out, cleared. `onPaper`: the target holds the paper already, so even
 * the bottom layer's eraser would cut into it.
 */
export function renderLayersStacked(
  cells: readonly Frame[],
  tools: readonly ToolDescriptor[],
  target: Canvas2DLike,
  viewport: Viewport,
  apart: () => ScratchLayer,
  /** Where the strokes' paths are kept to be drawn again; none kept without. */
  paths?: PathKeeper<StrokePaths>,
  /** Each cell's layer look, by position; absent — every layer plain. */
  looks?: readonly (LayerLook | undefined)[],
  onPaper = false,
  mask?: () => ScratchLayer,
): void {
  for (const [index, cell] of cells.entries()) {
    const look = looks?.[index];
    if (cell.raster) {
      drawRasterCel(cell.raster, target, viewport, look);
      continue;
    }
    if (!hasLook(look) && ((index === 0 && !onPaper) || !hasEraser(cell, tools))) {
      renderStrokesLayer(cell, tools, target, viewport, undefined, paths, mask);
      continue;
    }
    const own = apart();
    renderStrokesLayer(cell, tools, own.ctx, viewport, undefined, paths, mask);
    layLayer(own.image, target, look);
  }
}

function drawRasterCel(
  cel: NonNullable<Frame['raster']>,
  target: Canvas2DLike,
  viewport: Viewport,
  look?: LayerLook,
): void {
  const image = viewport.raster?.(cel);
  if (!image || look?.opacity === 0) return;
  applyDocTransform(target, viewport);
  if (look?.opacity !== undefined) target.globalAlpha = look.opacity / 100;
  if (look?.blend) target.globalCompositeOperation = look.blend;
  target.drawImage(image, cel.x * FIXED_POINT_SCALE, cel.y * FIXED_POINT_SCALE,
    cel.width * FIXED_POINT_SCALE, cel.height * FIXED_POINT_SCALE);
  if (look?.opacity !== undefined) target.globalAlpha = 1;
  if (look?.blend) target.globalCompositeOperation = 'source-over';
}

/** Lays a layer's buffer onto the target with its look, and leaves the target plain again. */
export function layLayer(source: CanvasImageSource, target: BlitTarget & LookTarget, look: LayerLook | undefined): void {
  if (!hasLook(look)) {
    blitLayer(source, target);
    return;
  }
  target.globalAlpha = (look!.opacity ?? 100) / 100;
  if (look!.blend) target.globalCompositeOperation = look!.blend;
  blitLayer(source, target);
  target.globalAlpha = 1;
  if (look!.blend) target.globalCompositeOperation = 'source-over';
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

/** Live preview of points a brush has already prepared. */
export function renderResolvedPreview(
  points: readonly number[],
  tool: ToolDescriptor,
  color: string,
  target: Canvas2DLike,
  viewport: Viewport,
  /** Pen pressure per point, when the line under the hand carries it. */
  pressure?: readonly number[],
): void {
  if (points.length < 2) return;
  applyDocTransform(target, viewport);
  drawResolvedStroke(target, points, tool, color, viewport.scale * viewport.dpr, pressure);
}

/**
 * The stretch of a live line between two joins, onto a target that already
 * holds what came before it.
 *
 * A live stroke grows at one end, and redrawing it whole on every frame costs
 * the whole line over and over: the longer the line, the further it trails the
 * hand. What has settled stays on the buffer, and only the commands still
 * moving are drawn again. `until` is the last command drawn — `Infinity` for
 * "to the end of the line".
 *
 * False means the line cannot be split that way and nothing was drawn: the
 * caller draws it whole.
 */
export function renderLivePart(
  points: readonly number[],
  geometry: StrokeGeometry,
  width: number,
  color: string,
  target: Canvas2DLike,
  viewport: Viewport,
  from: number,
  until = Infinity,
): boolean {
  if (points.length < 4) {
    // One point is a dot, and a dot is drawn whole or not at all.
    return false;
  }
  applyDocTransform(target, viewport);
  target.beginPath();
  const precision = roundTurnPrecision(target, geometry, viewport.scale * viewport.dpr);
  const sink = strokeSink(target, width, precision);
  if (!emitGeometryFrom(points, geometry, from, sink, until)) {
    return false;
  }
  target.lineWidth = width;
  target.strokeStyle = color;
  target.lineCap = 'round';
  target.lineJoin = 'round';
  target.stroke();
  return true;
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
  /**
   * Where the strokes' paths are kept to be drawn again: the studio's canvas
   * ([`STUDIO_PATHS`]). Without it nothing is kept — what draws a stroke once
   * (the player, exports, thumbnails) would only hold memory.
   */
  paths?: PathKeeper<StrokePaths>,
  makeMask?: () => ScratchLayer,
): void {
  if (frame.raster) {
    drawRasterCel(frame.raster, target, viewport);
    return;
  }
  let mask: ScratchLayer | undefined;
  applyDocTransform(target, viewport);
  for (let i = 0; i < frame.strokes.length;) {
    const stroke = frame.strokes[i];
    const tool = resolveTool(tools, stroke);
    // A single paint command already applies its alpha once. Only a matching
    // neighbour or a feather's overlapping fill and outline need isolation.
    const next = i + 1;
    if (isFlatPaint(tool)
      && (extendsFlatRun(frame.strokes, next, tools)
        || hasInteriorPaint(tool, stroke.points)
        || (target.withOpacityGroup && target.globalAlpha === undefined))
      && (target.withOpacityGroup || (target.canvas && typeof target.drawImage === 'function'))) {
      let end = next;
      while (extendsFlatRun(frame.strokes, end, tools)) end++;
      const draw = (ctx: Canvas2DLike) => renderOpaqueRun(frame.strokes, i, end, tools, ctx, viewport, tint, paths);
      if (target.withOpacityGroup) {
        target.withOpacityGroup(tool.opacity / 100, () => draw(target));
      } else {
        mask ??= makeMask?.() ?? domScratch(target.canvas.width, target.canvas.height);
        mask.ctx.setTransform(1, 0, 0, 1, 0, 0);
        mask.ctx.clearRect(0, 0, target.canvas.width, target.canvas.height);
        draw(mask.ctx);
        layLayer(mask.image, target, tool);
        applyDocTransform(target, viewport);
      }
      i = end;
      continue;
    }

    const erase = isEraserTool(tool);
    const { opacity } = opacityOf(tool);
    if (erase) target.globalCompositeOperation = 'destination-out';
    if (opacity !== undefined) target.globalAlpha = opacity / 100;
    drawPlacedStroke(stroke, tool, target, viewport, tint, paths);
    if (opacity !== undefined) target.globalAlpha = 1;
    if (erase) target.globalCompositeOperation = 'source-over';
    i++;
  }
}

export function renderOpaqueRun(
  strokes: Frame['strokes'], start: number, end: number, tools: readonly ToolDescriptor[],
  target: Canvas2DLike, viewport: Viewport, tint?: string, paths?: PathKeeper<StrokePaths>,
): void {
  applyDocTransform(target, viewport);
  for (let i = start; i < end; i++) {
    drawPlacedStroke(strokes[i], resolveTool(tools, strokes[i]), target, viewport, tint, paths);
  }
}

function drawPlacedStroke(
  stroke: PlacedStroke, tool: ToolDescriptor, target: Canvas2DLike, viewport: Viewport,
  tint?: string, paths?: PathKeeper<StrokePaths>,
): void {
  let scale = viewport.scale * viewport.dpr;
  if (stroke.place) {
    placeTransform(target, viewport, stroke.place);
    if (isGecko) {
      const [a, b, c, d] = stroke.place;
      // The Frobenius norm bounds the largest stretch of the placement.
      scale *= Math.hypot(a, b, c, d);
    }
  }
  drawResolvedStroke(target, stroke.points, tool, tint && !isEraserTool(tool) ? tint : toolColor(tool), scale, stroke.pressure, paths);
  if (stroke.place) applyDocTransform(target, viewport);
}

/**
 * A stroke of a selection being moved, as the studio's canvas hands it in: its
 * own points, never rewritten, and the session's matrix that carries them
 * (`keepsShape` in tools/lasso.ts). The stroke's kept path is drawn under the
 * view times that matrix. The Gecko curve approximation can need a finer
 * path when a placement increases the raster scale.
 */
export type PlacedStroke = Frame['strokes'][number] & {
  /** Document → document, in `setTransform` order: a, b, c, d, e, f. */
  readonly place?: readonly number[];
};

/** The view times the stroke's matrix. */
function placeTransform(target: Canvas2DLike, viewport: Viewport, [a, b, c, d, e, f]: readonly number[]): void {
  const k = viewport.scale * viewport.dpr;
  const ox = (viewport.panX ?? 0) * viewport.dpr;
  const oy = (viewport.panY ?? 0) * viewport.dpr;
  target.setTransform(k * a, k * b, k * c, k * d, k * e + ox, k * f + oy);
}

/**
 * A stroke's paths in document units. An approximated Gecko stroke is kept
 * at the precision its raster scale needs. Other paths can be reused at any
 * scale or placement.
 */
export interface StrokePaths {
  /** The feather's fill under a pressured outline: filled in the tool's fill. */
  readonly under?: Path2D;
  readonly main: Path2D;
  /** Filled in the paint colour; otherwise stroked at the tool's width. */
  readonly filled: boolean;
  /** A feather's line: its own path filled in the tool's fill before the stroke. */
  readonly fillFirst: boolean;
  /** Estimated bytes added by replacing tight curves and keeping the feather fill separately. */
  readonly extraBytes?: number;
}

/**
 * The studio's kept paths: as much as the device's memory allows, by the same
 * steps as its kept cells (cell-cache.ts `cellBudget`), the longest unused let
 * go first.
 */
export const STUDIO_PATHS = new PathKeeper<StrokePaths>(
  cellBudget(typeof navigator === 'undefined' ? undefined : (navigator as { deviceMemory?: number }).deviceMemory),
  (paths) => paths.extraBytes ?? 0,
);

const isGecko = /\bGecko\//.test(globalThis.navigator?.userAgent ?? '');

function roundTurnPrecision(target: Canvas2DLike, geometry: StrokeGeometry, scale: number): number {
  if (isGecko && geometry !== 'line' && (
    (typeof CanvasRenderingContext2D !== 'undefined' && target instanceof CanvasRenderingContext2D) ||
    (typeof OffscreenCanvasRenderingContext2D !== 'undefined' && target instanceof OffscreenCanvasRenderingContext2D)
  )) {
    // Bound the chord error to a quarter of a raster pixel. Use integer
    // precision levels so small changes in the transform can share a path.
    return Math.max(1, Math.ceil(scale * 4));
  }
  return 0;
}

function strokeSink(sink: PathSink, width: number, precision: number): PathSink {
  return precision > 0 ? new RoundTurnSink(sink, width, precision) : sink;
}

function buildPaths(
  points: readonly number[], tool: ToolDescriptor, pressure: readonly number[] | undefined, precision: number,
): StrokePaths {
  const main = new Path2D();
  if (isStampTool(tool)) {
    emitStamps(points, tool, main);
    return { main, filled: true, fillFirst: false };
  }
  if (isContourTool(tool)) {
    emitPathForTool(points, tool, main);
    return { main, filled: true, fillFirst: false };
  }
  if (pressure && pressure.length === points.length / 2) {
    let under: Path2D | undefined;
    if (isFilledLineTool(tool)) {
      under = new Path2D();
      emitPathForTool(points, tool, under);
    }
    emitPressuredOutline(flattenPressured(points, pressure, tool.geometry), tool.width, main);
    return { under, main, filled: true, fillFirst: false };
  }
  if (isDot(points)) {
    main.arc(points[0], points[1], tool.width / 2, 0, Math.PI * 2);
    return { main, filled: true, fillFirst: false };
  }
  const sink = strokeSink(main, tool.width, precision);
  emitPathForTool(points, tool, sink);
  const extraBytes = sink instanceof RoundTurnSink ? sink.flattenedSegments * 64 : 0;
  if (isFilledLineTool(tool) && extraBytes > 0) {
    const under = new Path2D();
    emitPathForTool(points, tool, under);
    return { under, main, filled: false, fillFirst: false, extraBytes: extraBytes + pathCost(points) };
  }
  return { main, filled: false, fillFirst: isFilledLineTool(tool), extraBytes };
}

/** A stamp's marks, the places a fast drag skipped filled in, as one path. */
function emitStamps(points: readonly number[], tool: ToolDescriptor & { kind: 'stamp' }, sink: PathSink): void {
  const stamp = (x: number, y: number): void => {
    sink.moveTo(x + tool.shape[0] * tool.width, y + tool.shape[1] * tool.width);
    for (let i = 2; i < tool.shape.length; i += 2) {
      sink.lineTo(x + tool.shape[i] * tool.width, y + tool.shape[i + 1] * tool.width);
    }
    sink.lineTo(x + tool.shape[0] * tool.width, y + tool.shape[1] * tool.width);
  };
  for (let i = 0; i < points.length; i += 2) {
    if (i >= 2) {
      const between = interpolatePixelLine(points[i - 2], points[i - 1], points[i], points[i + 1], tool.width);
      for (let j = 0; j < between.length; j += 2) {
        stamp(between[j], between[j + 1]);
      }
    }
    stamp(points[i], points[i + 1]);
  }
}

function drawResolvedStroke(
  target: Canvas2DLike,
  points: readonly number[],
  tool: ToolDescriptor,
  color: string,
  scale: number,
  pressure?: readonly number[],
  /**
   * Where a committed stroke's path is kept, its points never changing. The
   * line under the hand grows in place, so a kept path would be the line as it was.
   */
  keep?: PathKeeper<StrokePaths>,
): void {
  const hasPressure = pressure && pressure.length === points.length / 2;
  const precision = isGecko && !hasPressure && !isStampTool(tool) && !isContourTool(tool)
    ? roundTurnPrecision(target, tool.geometry, scale)
    : 0;
  if (keep && typeof Path2D !== 'undefined') {
    const paths = keep.take(points, tool, pressure, () => buildPaths(points, tool, pressure, precision), precision);
    if (paths.under) {
      target.fillStyle = (tool as { fill: string }).fill;
      target.fill(paths.under);
    }
    if (paths.filled) {
      target.fillStyle = color;
      target.fill(paths.main);
      return;
    }
    if (paths.fillFirst) {
      target.fillStyle = (tool as { fill: string }).fill;
    }
    target.lineWidth = (tool as { width: number }).width;
    target.strokeStyle = color;
    target.lineCap = 'round';
    target.lineJoin = 'round';
    if (paths.fillFirst) {
      target.fill(paths.main);
    }
    target.stroke(paths.main);
    return;
  }
  if (isStampTool(tool)) {
    // Every stored point is a place the tool's polygon is stamped at, `width`
    // document units across, with the places a fast drag skipped filled in by
    // Bresenham between consecutive points — the capture side stores only what
    // the pointer actually visited. The square of the pixel tool is one such
    // polygon; a brush with another outline is the same code and other data,
    // which is why the player can draw a shape it has never heard of.
    //
    // The whole stroke is one path and one fill. Marks filled one by one left
    // a hairline between neighbours wherever the scale put their shared edge
    // inside a pixel: each covered its half of it, and the two halves do not
    // add up to the whole.
    target.fillStyle = color;
    target.beginPath();
    const stamp = (x: number, y: number): void => {
      target.moveTo(x + tool.shape[0] * tool.width, y + tool.shape[1] * tool.width);
      for (let i = 2; i < tool.shape.length; i += 2) {
        target.lineTo(x + tool.shape[i] * tool.width, y + tool.shape[i + 1] * tool.width);
      }
      target.lineTo(x + tool.shape[0] * tool.width, y + tool.shape[1] * tool.width);
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
    target.fill();
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
  // Pen pressure: the width changes along the line, which a canvas stroke
  // cannot do — the outline is filled instead. A stamp and a contour have no
  // line width to vary and never reach here; an array that does not match the
  // points is not this stroke's and is not read.
  if (hasPressure) {
    const flat = flattenPressured(points, pressure, tool.geometry);
    if (isFilledLineTool(tool)) {
      target.fillStyle = tool.fill;
      emitPathForTool(points, tool, target);
      target.fill();
      target.beginPath();
    }
    target.fillStyle = color;
    emitPressuredOutline(flat, tool.width, target);
    target.fill();
    return;
  }
  // A tap can carry repeated samples. Fill it explicitly because Canvas
  // backends disagree about round caps on a curve with no length.
  if (isDot(points)) {
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
  const sink = strokeSink(target, tool.width, precision);
  if (filled && sink !== target) {
    emitPathForTool(points, tool, target);
    target.fill();
    target.beginPath();
  }
  emitPathForTool(points, tool, sink);
  if (filled && sink === target) {
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
    emitGeometry(points, 'smooth', false, target);
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
