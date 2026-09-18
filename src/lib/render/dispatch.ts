import type {
  ContourEraserToolDescriptor,
  ContourToolDescriptor,
  FeatherToolDescriptor,
  PixelToolDescriptor,
  StrokeV2,
  ToolDescriptor,
} from '../format/types';
import { emitMultatorClosedPath, emitMultatorPath, emitTonioPath, type PathSink } from './smoothing';

/** Whether a tool erases (alpha punch) rather than paints. */
export function isEraserTool(tool: ToolDescriptor): boolean {
  return tool.kind === 'eraser' || tool.kind === 'contour-eraser';
}

/** Whether a tool paints its path's interior as well as its outline (Tonio feather). */
export function isFilledLineTool(tool: ToolDescriptor): tool is FeatherToolDescriptor {
  return tool.kind === 'feather';
}

/** Whether a tool's points are grid cells filled as squares (Tonio pixel). */
export function isPixelTool(tool: ToolDescriptor): tool is PixelToolDescriptor {
  return tool.kind === 'pixel';
}

/** Whether a tool's points are a closed, filled contour (oldschool pen) rather than a line. */
export function isContourTool(
  tool: ToolDescriptor,
): tool is ContourToolDescriptor | ContourEraserToolDescriptor {
  return tool.kind === 'contour' || tool.kind === 'contour-eraser';
}

export function resolveTool(tools: readonly ToolDescriptor[], stroke: StrokeV2): ToolDescriptor {
  const descriptor = tools[stroke.tool_id];
  if (!descriptor) {
    throw new RangeError(`tool_id ${stroke.tool_id} does not reference an existing tool`);
  }
  return descriptor;
}

export function emitPathForTool(
  points: readonly number[],
  descriptor: ToolDescriptor,
  sink: PathSink,
): void {
  if (isContourTool(descriptor)) {
    emitMultatorClosedPath(points, sink);
  } else if (descriptor.dialect === 'toonio') {
    emitTonioPath(points, sink);
  } else {
    emitMultatorPath(points, sink);
  }
}
