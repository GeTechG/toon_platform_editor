import type {
  ContourEraserToolDescriptor,
  LineToolDescriptor,
  ContourToolDescriptor,
  FeatherToolDescriptor,
  StampToolDescriptor,
  Stroke,
  ToolDescriptor,
} from '../format/types';
import { emitGeometry, type PathSink } from './smoothing';

/**
 * The primitives a tool may lay down: what the renderer draws for a stroke a
 * pointer session collects. A plugin picks one of these and cannot invent
 * another (see `editor-plugins`) — the player draws the same document with
 * this same renderer.
 */
export const LINE_PRIMITIVES: readonly LineToolDescriptor['kind'][] = [
  'pencil',
  'eraser',
  'feather',
  'stamp',
];

/**
 * Every kind a stroke may carry in the document — the line primitives plus the
 * closed contours a commit may produce. A brush commits into one of these or
 * its stroke does not land (see `editor-plugins`).
 */
export const DOCUMENT_PRIMITIVES: readonly ToolDescriptor['kind'][] = [
  ...LINE_PRIMITIVES,
  'contour',
  'contour-eraser',
];

/** Whether a tool erases (alpha punch) rather than paints. */
export function isEraserTool(tool: ToolDescriptor): boolean {
  return tool.kind === 'eraser' || tool.kind === 'contour-eraser';
}

/** Whether a tool paints its path's interior as well as its outline. */
export function isFilledLineTool(tool: ToolDescriptor): tool is FeatherToolDescriptor {
  return tool.kind === 'feather';
}

/** Whether a tool's points are places its polygon is stamped at. */
export function isStampTool(tool: ToolDescriptor): tool is StampToolDescriptor {
  return tool.kind === 'stamp';
}

/** Whether a tool's points are a closed, filled contour (oldschool pen) rather than a line. */
export function isContourTool(
  tool: ToolDescriptor,
): tool is ContourToolDescriptor | ContourEraserToolDescriptor {
  return tool.kind === 'contour' || tool.kind === 'contour-eraser';
}

export function resolveTool(tools: readonly ToolDescriptor[], stroke: Stroke): ToolDescriptor {
  const descriptor = tools[stroke.tool_id];
  if (!descriptor) {
    throw new RangeError(`tool_id ${stroke.tool_id} does not reference an existing tool`);
  }
  return descriptor;
}

/**
 * The stored numbers into a path. Two things decide it and neither names a
 * brush: `geometry` says how the numbers are read, `kind` says whether the
 * path is a closed filled ring.
 */
export function emitPathForTool(
  points: readonly number[],
  descriptor: ToolDescriptor,
  sink: PathSink,
): void {
  emitGeometry(points, descriptor.geometry, isContourTool(descriptor), sink);
}

export type FlatPaint = Extract<ToolDescriptor, { color: string }> & { opacity: number; buildup: false };

export function isFlatPaint(tool: ToolDescriptor | undefined): tool is FlatPaint {
  return tool !== undefined && 'color' in tool && tool.buildup === false && tool.opacity !== undefined;
}

/** The width and geometry can change without starting another coat of the same paint. */
export function sameFlatPaint(a: ToolDescriptor | undefined, b: ToolDescriptor | undefined): boolean {
  return isFlatPaint(a) && isFlatPaint(b) && a.opacity === b.opacity && a.color === b.color
    && ('fill' in a ? a.fill : a.color) === ('fill' in b ? b.fill : b.color);
}

/** A feather's fill can overlap its outline only if its points can enclose an area. */
export function hasInteriorPaint(tool: ToolDescriptor, points: readonly number[]): boolean {
  if (!isFilledLineTool(tool) || points.length < 6) return false;
  const [x, y] = points;
  let second = 2;
  while (second < points.length && points[second] === x && points[second + 1] === y) second += 2;
  if (second === points.length) return false;
  const dx = points[second] - x;
  const dy = points[second + 1] - y;
  for (let i = second + 2; i < points.length; i += 2) {
    if (dx * (points[i + 1] - y) !== dy * (points[i] - x)) return true;
  }
  return false;
}

/** The first new stroke belongs to the same coat as the last stroke on the cached prefix. */
export function extendsFlatRun(
  strokes: readonly Pick<Stroke, 'tool_id'>[], start: number, tools: readonly ToolDescriptor[],
): boolean {
  return start > 0 && start < strokes.length
    && sameFlatPaint(tools[strokes[start - 1].tool_id], tools[strokes[start].tool_id]);
}
