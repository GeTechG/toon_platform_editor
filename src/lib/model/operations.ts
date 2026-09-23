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
  MAX_LAYER_NAME,
  MAX_LAYERS,
  MAX_STROKE_COORDS,
  MAX_STROKE_WIDTH,
  MAX_STROKES_PER_FRAME,
  MAX_TOTAL_POINTS,
  SCHEMA_VERSION,
  STROKE_COORD_MAX,
  STROKE_COORD_MIN,
} from '../format/constants';
import type { Stroke, Frame, ToonDocument, ToolDescriptor } from '../format/types';

/**
 * A stroke as a brush hands it over before it is interned: the attributes are
 * still inline, because the brush has no idea which descriptor the document
 * already holds. `addStroke` interns them and the shape stops existing.
 */
export interface BuiltStroke {
  points: number[];
  width: number;
  color: string;
  erase?: true;
}

export interface BuiltFrame {
  strokes: BuiltStroke[];
}
import type { Matrix } from './geom';
import { applyMatrix, clampCoord, transformMatrix } from './geom';
import { pixelCellNearest } from '../tools/pixel';

export interface ResolvedStroke {
  points: number[];
  tool: ToolDescriptor;
  /** Pen pressure per point (see `Stroke.pressure`). */
  pressure?: number[];
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
  if (left.kind !== right.kind || left.geometry !== right.geometry) {
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
    case 'stamp':
      return right.kind === 'stamp'
        && left.width === right.width
        && left.color === right.color
        && left.shape.length === right.shape.length
        && left.shape.every((value, i) => value === right.shape[i]);
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
/**
 * Nothing drawn anywhere: no stroke in any cell of any layer. What tells a
 * sheet nobody has touched from work worth holding the tab open for.
 */
export function isEmptyDocument(doc: ToonDocument): boolean {
  return doc.layers.every((layer) => layer.frames.every((frame) => frame.strokes.length === 0));
}

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

/**
 * Inserts an empty layer at `at`, which may be anywhere from under the bottom
 * layer (0) to one past the top (`layers.length`); returns that index.
 */
export function addLayer(doc: ToonDocument, at: number): number {
  if (!Number.isInteger(at) || at < 0 || at > doc.layers.length) {
    throw new RangeError(`layer index ${at} is out of range 0..${doc.layers.length}`);
  }
  if (doc.layers.length >= MAX_LAYERS) {
    throw new RangeError(`document already has the maximum of ${MAX_LAYERS} layers`);
  }
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

/**
 * Names a layer, or drops the name when the text is blank — a nameless row is
 * numbered by position. Over-long names are cut to `MAX_LAYER_NAME` rather than
 * refused: the reference truncates as you type.
 */
export function renameLayer(doc: ToonDocument, index: number, name: string): void {
  assertLayerIndex(doc, index);
  const trimmed = name.trim().slice(0, MAX_LAYER_NAME);
  if (trimmed) {
    doc.layers[index].name = trimmed;
  } else {
    delete doc.layers[index].name;
  }
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
    strokes: strokes.map((stroke) => ({
      points: stroke.points.slice(), tool_id: stroke.tool_id, ...pressureOf(stroke),
    })),
  };
}

/**
 * A stroke's pressure, copied, as a spread — or nothing when it has none or
 * an edit left it out of step with the points. An array that does not fit is
 * dropped whole rather than guessed at: the line keeps its tool's width, and
 * the document stays valid.
 */
export function pressureOf(stroke: { points: readonly number[]; pressure?: readonly number[] }): { pressure?: number[] } {
  const { pressure } = stroke;
  return pressure && pressure.length === stroke.points.length / 2 ? { pressure: pressure.slice() } : {};
}

/**
 * Overwrites the frame at `index` in every layer with a deep copy of the
 * column — the frame paste. Cell `i` of the buffer goes to layer `i`; layers
 * the buffer has no cell for are cleared, surplus cells are ignored (the
 * source document may have had a different number of layers). Limits are
 * checked before any mutation, so an oversized paste changes nothing.
 */
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
export function cloneFrame(frame: BuiltFrame): BuiltFrame;
export function cloneFrame(doc: ToonDocument, frame: Frame): ResolvedFrame;
export function cloneFrame(frameOrDoc: BuiltFrame | ToonDocument, maybeFrame?: Frame): BuiltFrame | ResolvedFrame {
  if (maybeFrame) {
    const doc = frameOrDoc as ToonDocument;
    return {
      strokes: maybeFrame.strokes.map((stroke) => {
        const tool = doc.tools[stroke.tool_id];
        if (!tool) throw new RangeError(`tool_id ${stroke.tool_id} does not reference an existing tool`);
        return { points: stroke.points.slice(), tool: copyTool(tool), ...pressureOf(stroke) };
      }),
    };
  }
  const frame = frameOrDoc as BuiltFrame;
  return { strokes: frame.strokes.map((s) => ({ ...s, points: s.points.slice() })) };
}

/** Appends a committed (already quantized) stroke to the cell of a layer. */
export function addStroke(
  doc: ToonDocument,
  layerIndex: number,
  frameIndex: number,
  stroke: ResolvedStroke | BuiltStroke,
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
    ...('tool' in stroke ? pressureOf(stroke) : {}),
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

function assertLegacyStroke(stroke: BuiltStroke): void {
  if (!Number.isInteger(stroke.width) || stroke.width < 1 || stroke.width > MAX_STROKE_WIDTH) {
    throw new RangeError(`stroke width must be an integer in 1..${MAX_STROKE_WIDTH}, got ${stroke.width}`);
  }
  if (!/^#[0-9a-f]{6}$/.test(stroke.color)) {
    throw new RangeError(`color must be lowercase #rrggbb, got ${stroke.color}`);
  }
}

function resolveLegacyStroke(stroke: BuiltStroke): ResolvedStroke {
  assertLegacyStroke(stroke);
  return {
    points: stroke.points,
    tool: stroke.erase || stroke.color === '#ffffff'
      ? { kind: 'eraser', geometry: 'smooth', width: stroke.width }
      : { kind: 'pencil', geometry: 'smooth', width: stroke.width, color: stroke.color },
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

function resolvedFrameToV2(doc: ToonDocument, frame: ResolvedFrame): Frame {
  return {
    strokes: frame.strokes.map((stroke) => {
      assertStrokePoints(stroke.points);
      assertTool(stroke.tool);
      return { points: stroke.points.slice(), tool_id: internTool(doc, stroke.tool), ...pressureOf(stroke) };
    }),
  };
}

/** Plain, field-exact copy of a descriptor (drops anything a caller may have attached). */
export function copyTool(tool: ToolDescriptor): ToolDescriptor {
  switch (tool.kind) {
    case 'pencil':
      return { kind: 'pencil', geometry: tool.geometry, width: tool.width, color: tool.color };
    case 'eraser':
      return { kind: 'eraser', geometry: tool.geometry, width: tool.width };
    case 'feather':
      return {
        kind: 'feather',
        geometry: tool.geometry,
        width: tool.width,
        color: tool.color,
        fill: tool.fill,
      };
    case 'stamp':
      return { kind: 'stamp', geometry: 'line', width: tool.width, color: tool.color, shape: [...tool.shape] };
    case 'contour':
      return { kind: 'contour', geometry: tool.geometry, color: tool.color };
    case 'contour-eraser':
      return { kind: 'contour-eraser', geometry: tool.geometry };
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

/** A rectangle of timeline cells, as index lists — the layers may have gaps (Ctrl+click). */
export interface CellRange {
  readonly frames: readonly number[];
  readonly layers: readonly number[];
}

/**
 * A copied block of cells, `[layer offset][frame offset]`. Strokes carry
 * resolved tools, so the block survives a document whose tool table differs.
 */
export type CellBuffer = ResolvedFrame[][];

/**
 * What a paste onto `target` is about to overwrite: whether any target cell
 * holds a stroke, and how wide the block is. The reference asks before it
 * overwrites, and asks a second time once more than one frame or layer is at
 * stake (`bundle:8192-8250`).
 */
export function pasteNeedsConfirm(
  doc: ToonDocument,
  target: CellRange,
): { nonEmpty: boolean; frames: number; layers: number } {
  const nonEmpty = target.layers.some((layer) =>
    target.frames.some((frame) => cell(doc, layer, frame).strokes.length > 0));
  return { nonEmpty, frames: target.frames.length, layers: target.layers.length };
}

/** Deep-copies the selected block for the timeline clipboard. */
export function copyCells(doc: ToonDocument, range: CellRange): CellBuffer {
  return range.layers.map((layerIndex) =>
    range.frames.map((frameIndex) => cloneFrame(doc, cell(doc, layerIndex, frameIndex))));
}

/**
 * Writes the buffer into the target cells and returns what they held, ready
 * to be the undo snapshot. The target is the authority on shape: surplus
 * buffer *layers* are cut off, while its frames repeat over the target ones.
 */
export function replaceCells(doc: ToonDocument, target: CellRange, buffer: CellBuffer): CellBuffer {
  return writeCells(doc, target, buffer, (_, incoming) => incoming);
}

/**
 * Like `replaceCells`, but the buffer's strokes land on top of the cell's own
 * — unless they are already sitting there. The reference's `AssignLines`
 * (`bundle:3762-3789`) skips what the cell's tail already holds, so pressing M
 * twice merges once.
 *
 * ponytail: all-or-nothing tail match; per-stroke dedup if a partial repeat
 * ever shows up in practice.
 */
export function mergeCells(doc: ToonDocument, target: CellRange, buffer: CellBuffer): CellBuffer {
  return writeCells(doc, target, buffer, (existing, incoming) =>
    tailHolds(existing.strokes, incoming.strokes)
      ? { strokes: [...existing.strokes] }
      : { strokes: [...existing.strokes, ...incoming.strokes] });
}

/** Whether `strokes` ends with exactly `tail` — same tools, same points. */
function tailHolds(strokes: readonly ResolvedStroke[], tail: readonly ResolvedStroke[]): boolean {
  if (tail.length === 0 || tail.length > strokes.length) {
    return false;
  }
  const offset = strokes.length - tail.length;
  return tail.every((stroke, i) => strokeEquals(strokes[offset + i], stroke));
}

function strokeEquals(a: ResolvedStroke, b: ResolvedStroke): boolean {
  return (
    a.points.length === b.points.length &&
    a.points.every((value, i) => value === b.points[i]) &&
    String(a.pressure) === String(b.pressure) &&
    toolEquals(a.tool, b.tool)
  );
}

function writeCells(
  doc: ToonDocument,
  target: CellRange,
  buffer: CellBuffer,
  combine: (existing: ResolvedFrame, incoming: ResolvedFrame) => ResolvedFrame,
): CellBuffer {
  const before = copyCells(doc, target);
  const written: { layer: number; frame: number; strokes: Stroke[] }[] = [];
  let outgoing = 0;
  let incoming = 0;
  // Both lists are bottom-up, and the block is anchored by its *top* layer, so
  // the layers pair from the end: a target with fewer rows than the buffer
  // keeps the buffer's top rows and drops what would fall off the bottom.
  for (let i = 0; i < target.layers.length && i < buffer.length; i++) {
    const t = target.layers.length - 1 - i;
    const source = buffer[buffer.length - 1 - i];
    const layer = target.layers[t];
    // Frames cycle: a buffer shorter than the target repeats over it, which is
    // how the reference fills a long selection from a two-frame copy.
    for (let f = 0; f < target.frames.length && source.length > 0; f++) {
      const frame = target.frames[f];
      const next = resolvedFrameToV2(doc, combine(before[t][f], source[f % source.length]));
      if (next.strokes.length > MAX_STROKES_PER_FRAME) {
        throw new RangeError(`frame has more than the maximum of ${MAX_STROKES_PER_FRAME} strokes`);
      }
      outgoing += pointCount(doc.layers[layer].frames[frame].strokes);
      incoming += pointCount(next.strokes);
      written.push({ layer, frame, strokes: next.strokes });
    }
  }
  if (totalPoints(doc) - outgoing + incoming > MAX_TOTAL_POINTS) {
    throw new RangeError(`document would exceed the limit of ${MAX_TOTAL_POINTS} points`);
  }
  for (const { layer, frame, strokes } of written) {
    doc.layers[layer].frames[frame] = { strokes };
  }
  return before;
}

/**
 * Rewrites the points of a cell's strokes through `map`, upholding the same
 * invariants a fresh stroke gets: whole coordinates inside int16. `indices`
 * picks the strokes (null = the whole cell); `widthScale` re-interns the tool
 * at a scaled width, which is what the transform window's "change width with
 * scale" checkbox asks for.
 *
 * Nothing is recorded for undo here — like the mega eraser, the caller
 * snapshots the cell first, so a transform is one ordinary undo step.
 */
function mapStrokes(
  doc: ToonDocument,
  layerIndex: number,
  frameIndex: number,
  indices: readonly number[] | null,
  map: (x: number, y: number) => [number, number],
  widthScale = 1,
): void {
  const target = cell(doc, layerIndex, frameIndex);
  const chosen = indices ?? target.strokes.map((_, i) => i);
  for (const index of chosen) {
    const stroke = target.strokes[index];
    if (!stroke) {
      continue;
    }
    const points = stroke.points;
    for (let i = 0; i < points.length; i += 2) {
      const [x, y] = map(points[i], points[i + 1]);
      points[i] = x;
      points[i + 1] = y;
    }
    // The width has to be rescaled before the points are quantized: a pixel
    // cell snaps onto the grid of the width it will be drawn at.
    if (widthScale !== 1) {
      stroke.tool_id = internTool(doc, scaleToolWidth(doc.tools[stroke.tool_id], widthScale));
    }
    quantizeStrokePoints(points, doc.tools[stroke.tool_id]);
  }
}

/**
 * The quantization a transformed stroke lands on: whole document units inside
 * int16, and — for the pixel tool, whose points are grid cells drawn as
 * squares — back onto the grid of the width it is drawn at. The canvas runs
 * its live preview through this too, so what is on screen during a drag is
 * exactly what apply writes.
 */
export function quantizeStrokePoints(points: number[], tool: ToolDescriptor): void {
  const stamped = tool.kind === 'stamp';
  for (let i = 0; i < points.length; i++) {
    points[i] = clampCoord(stamped ? pixelCellNearest(points[i], tool.width) : points[i]);
  }
}

/** The same descriptor with its width scaled into the format's 1..MAX range. */
export function scaleToolWidth(tool: ToolDescriptor, scale: number): ToolDescriptor {
  const copy = copyTool(tool);
  if (!('width' in copy)) {
    return copy;
  }
  return { ...copy, width: Math.min(MAX_STROKE_WIDTH, Math.max(1, Math.trunc(copy.width * scale))) };
}

/** Applies an affine transform to the chosen strokes of a cell (null = all). */
export function transformStrokes(
  doc: ToonDocument,
  layerIndex: number,
  frameIndex: number,
  indices: readonly number[] | null,
  matrix: Matrix,
  widthScale = 1,
): void {
  mapStrokes(doc, layerIndex, frameIndex, indices, (x, y) => applyMatrix(matrix, x, y), widthScale);
}

/** H / Shift+H: reflects a whole cell about the canvas centre. */
export function mirrorCell(
  doc: ToonDocument,
  layerIndex: number,
  frameIndex: number,
  axis: 'horizontal' | 'vertical',
): void {
  const flip = axis === 'horizontal' ? { scaleX: -1 } : { scaleY: -1 };
  transformStrokes(doc, layerIndex, frameIndex, null, transformMatrix(flip, doc.width / 2, doc.height / 2));
}


