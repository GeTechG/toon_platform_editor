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
  STROKE_COORD_MAX,
  STROKE_COORD_MIN,
} from '../format/constants';
import type {
  Frame,
  FrameV1,
  FrameV2,
  StrokeV1,
  ToonDocument,
  ToolDescriptor,
} from '../format/types';

export interface ResolvedStroke {
  points: number[];
  tool: ToolDescriptor;
}

export interface ResolvedFrame {
  strokes: ResolvedStroke[];
}

/** Returns the stable index of an immutable, structurally equal v2 tool descriptor. */
export function internTool(doc: ToonDocument, descriptor: ToolDescriptor): number {
  const existing = doc.tools.findIndex((tool) => toolEquals(tool, descriptor));
  if (existing !== -1) {
    return existing;
  }
  const stored: ToolDescriptor = descriptor.kind === 'pencil'
    ? { kind: 'pencil', dialect: descriptor.dialect, width: descriptor.width, color: descriptor.color }
    : { kind: 'eraser', dialect: descriptor.dialect, width: descriptor.width };
  doc.tools.push(stored);
  return doc.tools.length - 1;
}

function toolEquals(left: ToolDescriptor, right: ToolDescriptor): boolean {
  return left.kind === right.kind
    && left.dialect === right.dialect
    && left.width === right.width
    && (left.kind === 'eraser' || (right.kind === 'pencil' && left.color === right.color));
}

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
    schema_version: 2,
    width,
    height,
    frame_rate: frameRate,
    tools: [],
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

/**
 * Overwrites the frame at `index` with a deep copy of `frame` — the frame
 * paste: the copied strokes replace whatever the selected frame held. The
 * clone gives the frame a fresh identity (so render caches keyed on it
 * refresh) and keeps the document from sharing stroke arrays with the
 * caller's clipboard.
 */
export function replaceFrame(doc: ToonDocument, index: number, frame: ResolvedFrame | FrameV1): void;
export function replaceFrame(
  doc: ToonDocument,
  index: number,
  frame: ResolvedFrame | FrameV1,
): void {
  assertFrameIndex(doc, index);
  const outgoing = doc.frames[index].strokes.reduce((sum, s) => sum + s.points.length / 2, 0);
  const incoming = frame.strokes.reduce((sum, s) => sum + s.points.length / 2, 0);
  if (totalPoints(doc) - outgoing + incoming > MAX_TOTAL_POINTS) {
    throw new RangeError(`document would exceed the limit of ${MAX_TOTAL_POINTS} points`);
  }
  if (frame.strokes.length > MAX_STROKES_PER_FRAME) {
    throw new RangeError(`frame has more than the maximum of ${MAX_STROKES_PER_FRAME} strokes`);
  }
  const resolved = isResolvedFrame(frame) ? frame : resolveLegacyFrame(frame);
  doc.frames[index] = resolvedFrameToV2(doc, resolved);
}

/**
 * Removes the last stroke of a frame (per-stroke undo). Returns whether one
 * was removed — false on an already-empty frame.
 */
export function removeLastStroke(doc: ToonDocument, frameIndex: number): boolean {
  assertFrameIndex(doc, frameIndex);
  return doc.frames[frameIndex].strokes.pop() !== undefined;
}

/** Deep-copies a frame and its strokes' point arrays. */
export function cloneFrame(frame: FrameV1): FrameV1;
export function cloneFrame(doc: ToonDocument, frame: FrameV2): ResolvedFrame;
export function cloneFrame(frameOrDoc: FrameV1 | ToonDocument, maybeFrame?: FrameV2): FrameV1 | ResolvedFrame {
  if (maybeFrame) {
    const doc = frameOrDoc as ToonDocument;
    return {
      strokes: maybeFrame.strokes.map((stroke) => {
        const tool = doc.tools[stroke.tool_id];
        if (!tool) throw new RangeError(`tool_id ${stroke.tool_id} does not reference an existing tool`);
        return { points: stroke.points.slice(), tool: copyTool(tool) };
      }),
    };
  }
  const frame = frameOrDoc as FrameV1;
  return { strokes: frame.strokes.map((s) => ({ ...s, points: s.points.slice() })) };
}

/** Appends a committed (already quantized) stroke to a frame. */
export function addStroke(doc: ToonDocument, frameIndex: number, stroke: ResolvedStroke | StrokeV1): void;
export function addStroke(
  doc: ToonDocument,
  frameIndex: number,
  stroke: ResolvedStroke | StrokeV1,
): void {
  assertFrameIndex(doc, frameIndex);
  assertStrokePoints(stroke.points);
  if (doc.frames[frameIndex].strokes.length >= MAX_STROKES_PER_FRAME) {
    throw new RangeError(`frame already has the maximum of ${MAX_STROKES_PER_FRAME} strokes`);
  }
  if (totalPoints(doc) + stroke.points.length / 2 > MAX_TOTAL_POINTS) {
    throw new RangeError(`document would exceed the limit of ${MAX_TOTAL_POINTS} points`);
  }
  const resolved = 'tool' in stroke ? stroke : resolveLegacyStroke(stroke);
  assertTool(resolved.tool);
  doc.frames[frameIndex].strokes.push({
    points: resolved.points.slice(),
    tool_id: internTool(doc, resolved.tool),
  });
}

function assertStrokePoints(points: number[]): void {
  if (points.length < 2 || points.length % 2 !== 0) {
    throw new RangeError(`stroke must have an even coordinate count ≥ 2, got ${points.length}`);
  }
  if (points.length > MAX_STROKE_COORDS) {
    throw new RangeError(`stroke has ${points.length} coordinates — over the limit of ${MAX_STROKE_COORDS}`);
  }
  points.forEach((coord, i) => {
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
}

function assertLegacyStroke(stroke: StrokeV1): void {
  if (!Number.isInteger(stroke.width) || stroke.width < 1 || stroke.width > MAX_STROKE_WIDTH) {
    throw new RangeError(`stroke width must be an integer in 1..${MAX_STROKE_WIDTH}, got ${stroke.width}`);
  }
  if (!/^#[0-9a-f]{6}$/.test(stroke.color)) {
    throw new RangeError(`color must be lowercase #rrggbb, got ${stroke.color}`);
  }
}

function resolveLegacyStroke(stroke: StrokeV1): ResolvedStroke {
  assertLegacyStroke(stroke);
  return {
    points: stroke.points,
    tool: stroke.erase || stroke.color === '#ffffff'
      ? { kind: 'eraser', dialect: 'multator', width: stroke.width }
      : { kind: 'pencil', dialect: 'multator', width: stroke.width, color: stroke.color },
  };
}

function resolveLegacyFrame(frame: FrameV1): ResolvedFrame {
  return { strokes: frame.strokes.map(resolveLegacyStroke) };
}

function isResolvedFrame(frame: ResolvedFrame | FrameV1): frame is ResolvedFrame {
  return frame.strokes.length === 0 || 'tool' in frame.strokes[0];
}

function assertTool(tool: ToolDescriptor): void {
  if (!Number.isInteger(tool.width) || tool.width < 1 || tool.width > MAX_STROKE_WIDTH) {
    throw new RangeError(`tool width must be an integer in 1..${MAX_STROKE_WIDTH}, got ${tool.width}`);
  }
  if (tool.kind === 'pencil' && !/^#[0-9a-f]{6}$/.test(tool.color)) {
    throw new RangeError(`color must be lowercase #rrggbb, got ${tool.color}`);
  }
}

function resolvedFrameToV2(doc: ToonDocument, frame: ResolvedFrame): FrameV2 {
  return {
    strokes: frame.strokes.map((stroke) => {
      assertStrokePoints(stroke.points);
      assertTool(stroke.tool);
      return { points: stroke.points.slice(), tool_id: internTool(doc, stroke.tool) };
    }),
  };
}

function copyTool(tool: ToolDescriptor): ToolDescriptor {
  return tool.kind === 'pencil'
    ? { kind: 'pencil', dialect: tool.dialect, width: tool.width, color: tool.color }
    : { kind: 'eraser', dialect: tool.dialect, width: tool.width };
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
