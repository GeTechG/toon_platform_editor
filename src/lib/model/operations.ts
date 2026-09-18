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
  MAX_LAYERS,
  MAX_STROKE_COORDS,
  MAX_STROKE_WIDTH,
  MAX_STROKES_PER_FRAME,
  MAX_TOTAL_POINTS,
  SCHEMA_VERSION,
  STROKE_COORD_MAX,
  STROKE_COORD_MIN,
} from '../format/constants';
import type {
  Stroke,
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

/** One frame across every layer, bottom-up — what copy/paste moves around. */
export type ResolvedColumn = ResolvedFrame[];

/** Returns the stable index of an immutable, structurally equal v2 tool descriptor. */
export function internTool(doc: ToonDocument, descriptor: ToolDescriptor): number {
  const existing = doc.tools.findIndex((tool) => toolEquals(tool, descriptor));
  if (existing !== -1) {
    return existing;
  }
  doc.tools.push(copyTool(descriptor));
  return doc.tools.length - 1;
}

function toolEquals(left: ToolDescriptor, right: ToolDescriptor): boolean {
  if (left.kind !== right.kind || left.dialect !== right.dialect) {
    return false;
  }
  switch (left.kind) {
    case 'pencil':
      return right.kind === 'pencil' && left.width === right.width && left.color === right.color;
    case 'eraser':
      return right.kind === 'eraser' && left.width === right.width;
    case 'feather':
      return right.kind === 'feather'
        && left.width === right.width
        && left.color === right.color
        && left.fill === right.fill;
    case 'pixel':
      return right.kind === 'pixel' && left.width === right.width && left.color === right.color;
    case 'contour':
      return right.kind === 'contour' && left.color === right.color;
    case 'contour-eraser':
      return true;
  }
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
    schema_version: SCHEMA_VERSION,
    width,
    height,
    frame_rate: frameRate,
    tools: [],
    layers: [{ hidden: false, frames: [emptyFrame()] }],
  };
}

/** Number of frames — the same in every layer (a format invariant). */
export function frameCount(doc: ToonDocument): number {
  return doc.layers[0].frames.length;
}

/** The cell of a layer at a frame. */
function cell(doc: ToonDocument, layerIndex: number, frameIndex: number): Frame {
  assertLayerIndex(doc, layerIndex);
  assertFrameIndex(doc, frameIndex);
  return doc.layers[layerIndex].frames[frameIndex];
}

/** Inserts an empty frame after afterIndex; returns the new frame's index. */
export function addFrame(doc: ToonDocument, afterIndex: number): number {
  assertFrameIndex(doc, afterIndex);
  return insertEmptyFrame(doc, afterIndex + 1);
}

/** Inserts an empty frame in front of the frame at index (Ctrl+add); returns its index. */
export function insertFrameBefore(doc: ToonDocument, index: number): number {
  assertFrameIndex(doc, index);
  return insertEmptyFrame(doc, index);
}

function insertEmptyFrame(doc: ToonDocument, at: number): number {
  if (frameCount(doc) >= MAX_FRAMES) {
    throw new RangeError(`document already has the maximum of ${MAX_FRAMES} frames`);
  }
  for (const layer of doc.layers) {
    layer.frames.splice(at, 0, emptyFrame());
  }
  return at;
}

/**
 * Removes a frame from every layer. A document always keeps at least one
 * frame: removing the last remaining one clears its cells instead, so the
 * layers themselves survive.
 */
export function removeFrame(doc: ToonDocument, index: number): void {
  assertFrameIndex(doc, index);
  const last = frameCount(doc) === 1;
  for (const layer of doc.layers) {
    if (last) {
      layer.frames[0].strokes.length = 0;
    } else {
      layer.frames.splice(index, 1);
    }
  }
}

/** Inserts an empty layer above `belowIndex`; returns the new layer's index. */
export function addLayer(doc: ToonDocument, belowIndex: number): number {
  assertLayerIndex(doc, belowIndex);
  if (doc.layers.length >= MAX_LAYERS) {
    throw new RangeError(`document already has the maximum of ${MAX_LAYERS} layers`);
  }
  const at = belowIndex + 1;
  const frames = Array.from({ length: frameCount(doc) }, emptyFrame);
  doc.layers.splice(at, 0, { hidden: false, frames });
  return at;
}

/** Removes a layer; the last remaining layer cannot be removed. */
export function removeLayer(doc: ToonDocument, index: number): void {
  assertLayerIndex(doc, index);
  if (doc.layers.length === 1) {
    throw new RangeError('a document must keep at least one layer');
  }
  doc.layers.splice(index, 1);
}

/** Moves a layer to another position, shifting the rest. */
export function moveLayer(doc: ToonDocument, from: number, to: number): void {
  assertLayerIndex(doc, from);
  assertLayerIndex(doc, to);
  if (from === to) {
    return;
  }
  const [layer] = doc.layers.splice(from, 1);
  doc.layers.splice(to, 0, layer);
}

/** Shows or hides a layer (a document change: `hidden` is stored). */
export function setLayerHidden(doc: ToonDocument, index: number, hidden: boolean): void {
  assertLayerIndex(doc, index);
  doc.layers[index].hidden = hidden;
}

/**
 * Overwrites the frame at `index` in every layer with a deep copy of the
 * column — the frame paste. Cell `i` of the buffer goes to layer `i`; layers
 * the buffer has no cell for are cleared, surplus cells are ignored (the
 * source document may have had a different number of layers). Limits are
 * checked before any mutation, so an oversized paste changes nothing.
 */
/**
 * Replaces one cell's strokes wholesale — what the mega eraser does after it
 * cuts. The strokes must already reference tools of this document; nothing is
 * interned here, because cutting a line never invents a new tool.
 */
export function replaceStrokes(
  doc: ToonDocument,
  layerIndex: number,
  frameIndex: number,
  strokes: readonly Stroke[],
): void {
  assertLayerIndex(doc, layerIndex);
  assertFrameIndex(doc, frameIndex);
  if (strokes.length > MAX_STROKES_PER_FRAME) {
    throw new RangeError(`frame has more than the maximum of ${MAX_STROKES_PER_FRAME} strokes`);
  }
  for (const stroke of strokes) {
    if (!doc.tools[stroke.tool_id]) {
      throw new RangeError(`tool_id ${stroke.tool_id} does not reference an existing tool`);
    }
    assertStrokePoints(stroke.points);
  }
  const outgoing = pointCount(doc.layers[layerIndex].frames[frameIndex].strokes);
  const incoming = pointCount(strokes as Stroke[]);
  if (totalPoints(doc) - outgoing + incoming > MAX_TOTAL_POINTS) {
    throw new RangeError(`document would exceed the limit of ${MAX_TOTAL_POINTS} points`);
  }
  doc.layers[layerIndex].frames[frameIndex] = {
    strokes: strokes.map((stroke) => ({ points: stroke.points.slice(), tool_id: stroke.tool_id })),
  };
}

export function replaceColumn(doc: ToonDocument, index: number, column: ResolvedColumn): void {
  assertFrameIndex(doc, index);
  const width = Math.min(doc.layers.length, column.length);
  let outgoing = 0;
  let incoming = 0;
  for (let l = 0; l < doc.layers.length; l++) {
    outgoing += pointCount(doc.layers[l].frames[index].strokes);
    if (l < width) {
      incoming += pointCount(column[l].strokes);
      if (column[l].strokes.length > MAX_STROKES_PER_FRAME) {
        throw new RangeError(`frame has more than the maximum of ${MAX_STROKES_PER_FRAME} strokes`);
      }
    }
  }
  if (totalPoints(doc) - outgoing + incoming > MAX_TOTAL_POINTS) {
    throw new RangeError(`document would exceed the limit of ${MAX_TOTAL_POINTS} points`);
  }
  for (let l = 0; l < doc.layers.length; l++) {
    doc.layers[l].frames[index] = l < width ? resolvedFrameToV2(doc, column[l]) : emptyFrame();
  }
}

function pointCount(strokes: { points: number[] }[]): number {
  return strokes.reduce((sum, s) => sum + s.points.length / 2, 0);
}

/**
 * Removes the last stroke of a frame (per-stroke undo). Returns whether one
 * was removed — false on an already-empty frame.
 */
export function removeLastStroke(
  doc: ToonDocument,
  layerIndex: number,
  frameIndex: number,
): boolean {
  return cell(doc, layerIndex, frameIndex).strokes.pop() !== undefined;
}

/** Deep-copies the cell of every layer at `frameIndex`, bottom-up. */
export function cloneColumn(doc: ToonDocument, frameIndex: number): ResolvedColumn {
  assertFrameIndex(doc, frameIndex);
  return doc.layers.map((layer) => cloneFrame(doc, layer.frames[frameIndex]));
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

/** Appends a committed (already quantized) stroke to the cell of a layer. */
export function addStroke(
  doc: ToonDocument,
  layerIndex: number,
  frameIndex: number,
  stroke: ResolvedStroke | StrokeV1,
): void {
  const target = cell(doc, layerIndex, frameIndex);
  assertStrokePoints(stroke.points);
  if (target.strokes.length >= MAX_STROKES_PER_FRAME) {
    throw new RangeError(`frame already has the maximum of ${MAX_STROKES_PER_FRAME} strokes`);
  }
  if (totalPoints(doc) + stroke.points.length / 2 > MAX_TOTAL_POINTS) {
    throw new RangeError(`document would exceed the limit of ${MAX_TOTAL_POINTS} points`);
  }
  const resolved = 'tool' in stroke ? stroke : resolveLegacyStroke(stroke);
  assertTool(resolved.tool);
  target.strokes.push({
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



function assertTool(tool: ToolDescriptor): void {
  if (tool.kind === 'pencil' || tool.kind === 'eraser') {
    if (!Number.isInteger(tool.width) || tool.width < 1 || tool.width > MAX_STROKE_WIDTH) {
      throw new RangeError(`tool width must be an integer in 1..${MAX_STROKE_WIDTH}, got ${tool.width}`);
    }
  }
  if ((tool.kind === 'pencil' || tool.kind === 'contour') && !/^#[0-9a-f]{6}$/.test(tool.color)) {
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

/** Plain, field-exact copy of a descriptor (drops anything a caller may have attached). */
export function copyTool(tool: ToolDescriptor): ToolDescriptor {
  switch (tool.kind) {
    case 'pencil':
      return { kind: 'pencil', dialect: tool.dialect, width: tool.width, color: tool.color };
    case 'eraser':
      return { kind: 'eraser', dialect: tool.dialect, width: tool.width };
    case 'feather':
      return {
        kind: 'feather',
        dialect: 'toonio',
        width: tool.width,
        color: tool.color,
        fill: tool.fill,
      };
    case 'pixel':
      return { kind: 'pixel', dialect: 'toonio', width: tool.width, color: tool.color };
    case 'contour':
      return { kind: 'contour', dialect: 'multator', color: tool.color };
    case 'contour-eraser':
      return { kind: 'contour-eraser', dialect: 'multator' };
  }
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
  for (const layer of doc.layers) {
    for (const frame of layer.frames) {
      total += pointCount(frame.strokes);
    }
  }
  return total;
}

function assertFrameIndex(doc: ToonDocument, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= frameCount(doc)) {
    throw new RangeError(`frame index ${index} is out of range 0..${frameCount(doc) - 1}`);
  }
}

function assertLayerIndex(doc: ToonDocument, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= doc.layers.length) {
    throw new RangeError(`layer index ${index} is out of range 0..${doc.layers.length - 1}`);
  }
}

function assertFrameRate(fps: number): void {
  if (!Number.isInteger(fps) || fps < 1 || fps > 60) {
    throw new RangeError(`frame_rate must be an integer in 1..60, got ${fps}`);
  }
}
