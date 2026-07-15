/**
 * Document operations — the only mutation path for the model.
 * They uphold format invariants (integer coordinates, at least one
 * frame); the same operation set will back the phase-3 plugin API.
 */

import {
  DEFAULT_DOC_HEIGHT,
  DEFAULT_DOC_WIDTH,
  DEFAULT_FPS,
  MAX_DOC_DIMENSION,
  MAX_FRAMES,
  MAX_STROKE_COORDS,
  MAX_STROKE_WIDTH,
  MAX_STROKES_PER_FRAME,
  MAX_TOTAL_POINTS,
  SCHEMA_VERSION,
  STROKE_COORD_MAX,
  STROKE_COORD_MIN,
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
  if (!Number.isInteger(width) || width < 1 || width > MAX_DOC_DIMENSION) {
    throw new RangeError(`canvas width must be an integer in 1..${MAX_DOC_DIMENSION}, got ${width}`);
  }
  if (!Number.isInteger(height) || height < 1 || height > MAX_DOC_DIMENSION) {
    throw new RangeError(`canvas height must be an integer in 1..${MAX_DOC_DIMENSION}, got ${height}`);
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
  if (doc.frames.length >= MAX_FRAMES) {
    throw new RangeError(`document already has the maximum of ${MAX_FRAMES} frames`);
  }
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
  if (stroke.points.length > MAX_STROKE_COORDS) {
    throw new RangeError(`stroke has ${stroke.points.length} coordinates — over the limit of ${MAX_STROKE_COORDS}`);
  }
  if (doc.frames[frameIndex].strokes.length >= MAX_STROKES_PER_FRAME) {
    throw new RangeError(`frame already has the maximum of ${MAX_STROKES_PER_FRAME} strokes`);
  }
  if (totalPoints(doc) + stroke.points.length / 2 > MAX_TOTAL_POINTS) {
    throw new RangeError(`document would exceed the limit of ${MAX_TOTAL_POINTS} points`);
  }
  stroke.points.forEach((coord, i) => {
    if (!Number.isInteger(coord)) {
      throw new RangeError(`coordinate points[${i}] must be an integer (quantized at commit), got ${coord}`);
    }
    // Off-canvas points are allowed (a stroke can leave the canvas);
    // only the int16 storage range is enforced.
    if (coord < STROKE_COORD_MIN || coord > STROKE_COORD_MAX) {
      throw new RangeError(
        `coordinate points[${i}] = ${coord} is outside int16 ${STROKE_COORD_MIN}..${STROKE_COORD_MAX}`,
      );
    }
  });
  if (!Number.isInteger(stroke.width) || stroke.width < 1 || stroke.width > MAX_STROKE_WIDTH) {
    throw new RangeError(`stroke width must be an integer in 1..${MAX_STROKE_WIDTH}, got ${stroke.width}`);
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

// O(strokes) scan per commit; keep a running counter if it ever shows up in profiles.
function totalPoints(doc: ToonDocument): number {
  let total = 0;
  for (const frame of doc.frames) {
    for (const stroke of frame.strokes) {
      total += stroke.points.length / 2;
    }
  }
  return total;
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
