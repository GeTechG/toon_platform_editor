import { describe, expect, it } from 'bun:test';
import type { PathSink } from './smoothing';
import type { StrokeV2, ToolDescriptor } from '../format/types';
import * as dispatch from './dispatch';

class Sink implements PathSink {
  log: string[] = [];
  moveTo(x: number, y: number): void { this.log.push(`M ${x} ${y}`); }
  lineTo(x: number, y: number): void { this.log.push(`L ${x} ${y}`); }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    this.log.push(`Q ${cx} ${cy} ${x} ${y}`);
  }
}

const pencil: ToolDescriptor = { kind: 'pencil', dialect: 'multator', width: 32, color: '#123456' };
const eraser: ToolDescriptor = { kind: 'eraser', dialect: 'toonio', width: 40 };

describe('tool resolver and path dispatcher', () => {
  it('resolves pencil and eraser descriptors by tool_id', () => {
    expect(dispatch.resolveTool([pencil, eraser], { points: [1, 2], tool_id: 0 })).toBe(pencil);
    expect(dispatch.resolveTool([pencil, eraser], { points: [1, 2], tool_id: 1 })).toBe(eraser);
  });

  it('rejects an invalid tool_id instead of guessing paint attributes', () => {
    const stroke: StrokeV2 = { points: [1, 2], tool_id: 2 };
    expect(() => dispatch.resolveTool([pencil, eraser], stroke)).toThrow('tool_id 2');
  });

  it('dispatches Multator geometry to the frozen midpoint emitter', () => {
    const sink = new Sink();
    dispatch.emitPathForTool([0, 0, 80, 80, 160, 0], pencil, sink);
    expect(sink.log).toEqual(['M 0 0', 'Q 80 80 160 0']);
  });

  it('dispatches Tonio geometry including the duplicate-endpoint workaround', () => {
    const sink = new Sink();
    dispatch.emitPathForTool([0, 0, 80, 80, 80, 80], eraser, sink);
    expect(sink.log).toEqual(['Q 0 0 40 40', 'Q 80.01 80.01 80.005 80.005']);
  });
});
