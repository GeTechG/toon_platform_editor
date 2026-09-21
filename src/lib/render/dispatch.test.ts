import { describe, expect, it } from 'bun:test';
import type { PathSink } from './smoothing';
import type { Stroke, ToolDescriptor } from '../format/types';
import * as dispatch from './dispatch';

class Sink implements PathSink {
  log: string[] = [];
  moveTo(x: number, y: number): void { this.log.push(`M ${x} ${y}`); }
  lineTo(x: number, y: number): void { this.log.push(`L ${x} ${y}`); }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    this.log.push(`Q ${cx} ${cy} ${x} ${y}`);
  }
  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void {
    this.log.push(`C ${a} ${b} ${c} ${d} ${x} ${y}`);
  }
}

const pencil: ToolDescriptor = { kind: 'pencil', geometry: 'smooth', width: 32, color: '#123456' };
const eraser: ToolDescriptor = { kind: 'eraser', geometry: 'smooth', width: 40 };

describe('tool resolver and path dispatcher', () => {
  it('resolves pencil and eraser descriptors by tool_id', () => {
    expect(dispatch.resolveTool([pencil, eraser], { points: [1, 2], tool_id: 0 })).toBe(pencil);
    expect(dispatch.resolveTool([pencil, eraser], { points: [1, 2], tool_id: 1 })).toBe(eraser);
  });

  it('rejects an invalid tool_id instead of guessing paint attributes', () => {
    const stroke: Stroke = { points: [1, 2], tool_id: 2 };
    expect(() => dispatch.resolveTool([pencil, eraser], stroke)).toThrow('tool_id 2');
  });

  it('reads a smooth stroke as the midpoint chain', () => {
    const sink = new Sink();
    dispatch.emitPathForTool([0, 0, 80, 80, 160, 0], pencil, sink);
    expect(sink.log).toEqual(['M 0 0', 'Q 80 80 160 0']);
  });

  it('reads a line stroke as a polyline, whatever the tool paints with', () => {
    const sink = new Sink();
    dispatch.emitPathForTool([0, 0, 80, 80, 80, 0], { ...eraser, geometry: 'line' }, sink);
    expect(sink.log).toEqual(['M 0 0', 'L 80 80', 'L 80 0']);
  });

  it('closes the path for a contour, because the kind says so and not the geometry', () => {
    const sink = new Sink();
    const contour: ToolDescriptor = { kind: 'contour', geometry: 'smooth', color: '#123456' };
    dispatch.emitPathForTool([0, 0, 80, 0, 80, 80, 0, 80], contour, sink);
    expect(sink.log[0]).toBe('M 40 0');
    expect(sink.log).toHaveLength(5);
  });
});
