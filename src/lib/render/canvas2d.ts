/**
 * Canvas 2D implementation of FrameRenderer + live stroke preview.
 * The only place where editor code talks to the Canvas API.
 */

import { BACKGROUND_COLOR } from '../format/constants';
import type { Frame } from '../format/types';
import type { FrameRenderer, Viewport } from './contract';
import { emitSmoothedPath, type PathSink } from './smoothing';

/**
 * Subset of CanvasRenderingContext2D used by the renderer.
 * A real context satisfies it structurally; tests plug in a
 * recording implementation.
 */
export interface Canvas2DLike extends PathSink {
  readonly canvas: { width: number; height: number };
  lineWidth: number;
  strokeStyle: string;
  fillStyle: string;
  lineCap: string;
  lineJoin: string;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
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

export class Canvas2DFrameRenderer implements FrameRenderer<Canvas2DLike> {
  render(frame: Frame, target: Canvas2DLike, viewport: Viewport): void {
    clearToBackground(target);
    applyDocTransform(target, viewport);
    for (const stroke of frame.strokes) {
      drawStrokePath(target, stroke.points, stroke.width, stroke.color, true);
    }
  }
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
): void {
  if (points.length < 2) {
    return;
  }
  applyDocTransform(target, viewport);
  drawStrokePath(target, points, width, color, false);
}

/**
 * Renders a frame's strokes onto a transparent layer (no background
 * clear) so it can be composited: the caller paints the background once
 * and stacks layers. `tint` overrides every stroke color — used for the
 * onion-skin neighbor layers, keeping tint at composition, not in the
 * frame data. Same stroke path as the FrameRenderer, minus the fill.
 */
export function renderStrokesLayer(
  frame: Frame,
  target: Canvas2DLike,
  viewport: Viewport,
  tint?: string,
): void {
  applyDocTransform(target, viewport);
  for (const stroke of frame.strokes) {
    drawStrokePath(target, stroke.points, stroke.width, tint ?? stroke.color, true);
  }
}

function clearToBackground(target: Canvas2DLike): void {
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.fillStyle = BACKGROUND_COLOR;
  target.fillRect(0, 0, target.canvas.width, target.canvas.height);
}

/** Maps document units to device pixels: k = scale × dpr. */
function applyDocTransform(target: Canvas2DLike, viewport: Viewport): void {
  const k = viewport.scale * viewport.dpr;
  target.setTransform(k, 0, 0, k, 0, 0);
}

function drawStrokePath(
  target: Canvas2DLike,
  points: readonly number[],
  width: number,
  color: string,
  smooth: boolean,
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
  target.stroke();
}
