/**
 * Document operations — the only mutation path for the model.
 * They uphold format invariants (integer coordinates, at least one
 * frame); the same operation set will back the phase-3 plugin API.
 */

import {
  DEFAULT_DOC_HEIGHT,
  DEFAULT_DOC_WIDTH,
  DEFAULT_FPS,
  SCHEMA_VERSION,
} from '../format/constants';
import type { Frame, Stroke, ToonDocument } from '../format/types';

export interface CreateDocumentOptions {
  width?: number;
  height?: number;
  frameRate?: number;
}

export function createDocument(options: CreateDocumentOptions = {}): ToonDocument {
  const width = options.width ?? DEFAULT_DOC_WIDTH;
  const height = options.height ?? DEFAULT_DOC_HEIGHT;
  const frameRate = options.frameRate ?? DEFAULT_FPS;
  if (!Number.isInteger(width) || width < 1) {
    throw new RangeError(`canvas width must be an integer ≥ 1, got ${width}`);
  }
  if (!Number.isInteger(height) || height < 1) {
    throw new RangeError(`canvas height must be an integer ≥ 1, got ${height}`);
  }
  assertFrameRate(frameRate);
  return {
    schema_version: SCHEMA_VERSION,
    width,
    height,
    frame_rate: frameRate,
    frames: [emptyFrame()],
  };
}

/** Inserts an empty frame after afterIndex; returns the new frame's index. */
export function addFrame(doc: ToonDocument, afterIndex: number): number {
  assertFrameIndex(doc, afterIndex);
  doc.frames.splice(afterIndex + 1, 0, emptyFrame());
  return afterIndex + 1;
}

/**
 * Removes a frame. A document always keeps at least one frame:
 * removing the last remaining frame clears it instead.
 */
export function removeFrame(doc: ToonDocument, index: number): void {
  assertFrameIndex(doc, index);
  if (doc.frames.length === 1) {
    doc.frames[0].strokes.length = 0;
    return;
  }
  doc.frames.splice(index, 1);
}

/** Appends a committed (already quantized) stroke to a frame. */
export function addStroke(doc: ToonDocument, frameIndex: number, stroke: Stroke): void {
  assertFrameIndex(doc, frameIndex);
  if (stroke.points.length < 2 || stroke.points.length % 2 !== 0) {
    throw new RangeError(`stroke must have an even coordinate count ≥ 2, got ${stroke.points.length}`);
  }
  stroke.points.forEach((coord, i) => {
    if (!Number.isInteger(coord)) {
      throw new RangeError(`coordinate points[${i}] must be an integer (quantized at commit), got ${coord}`);
    }
    const limit = i % 2 === 0 ? doc.width : doc.height;
    if (coord < 0 || coord > limit) {
      throw new RangeError(`coordinate points[${i}] = ${coord} is outside the canvas 0..${limit}`);
    }
  });
  if (!Number.isInteger(stroke.width) || stroke.width < 1) {
    throw new RangeError(`stroke width must be an integer ≥ 1, got ${stroke.width}`);
  }
  if (!/^#[0-9a-f]{6}$/.test(stroke.color)) {
    throw new RangeError(`color must be lowercase #rrggbb, got ${stroke.color}`);
  }
  doc.frames[frameIndex].strokes.push(stroke);
}

/** Sets the document frame rate (format bounds: 1..60). */
export function setFrameRate(doc: ToonDocument, fps: number): void {
  assertFrameRate(fps);
  doc.frame_rate = fps;
}

function emptyFrame(): Frame {
  return { strokes: [] };
}

function assertFrameIndex(doc: ToonDocument, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= doc.frames.length) {
    throw new RangeError(`frame index ${index} is out of range 0..${doc.frames.length - 1}`);
  }
}

function assertFrameRate(fps: number): void {
  if (!Number.isInteger(fps) || fps < 1 || fps > 60) {
    throw new RangeError(`frame_rate must be an integer in 1..60, got ${fps}`);
  }
}
