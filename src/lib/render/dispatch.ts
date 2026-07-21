import type { StrokeV2, ToolDescriptor } from '../format/types';
import { emitMultatorPath, emitTonioPath, type PathSink } from './smoothing';

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
  if (descriptor.dialect === 'toonio') {
    emitTonioPath(points, sink);
  } else {
    emitMultatorPath(points, sink);
  }
}
