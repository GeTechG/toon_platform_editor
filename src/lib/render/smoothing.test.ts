import { describe, expect, it } from 'bun:test';
import { emitSmoothedPath, type PathSink } from './smoothing';

class RecordingSink implements PathSink {
  commands: string[] = [];
  moveTo(x: number, y: number): void {
    this.commands.push(`M ${x} ${y}`);
  }
  lineTo(x: number, y: number): void {
    this.commands.push(`L ${x} ${y}`);
  }
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.commands.push(`Q ${cpx} ${cpy} ${x} ${y}`);
  }
}

function emit(points: number[]): string[] {
  const sink = new RecordingSink();
  emitSmoothedPath(points, sink);
  return sink.commands;
}

describe('emitSmoothedPath (midpoint quadratic Béziers)', () => {
  it('empty input — no commands', () => {
    expect(emit([])).toEqual([]);
  });

  it('single point — moveTo only', () => {
    expect(emit([5, 6])).toEqual(['M 5 6']);
  });

  it('two points — a straight segment', () => {
    expect(emit([0, 0, 10, 20])).toEqual(['M 0 0', 'L 10 20']);
  });

  it('builds curves: control = stored point, end = midpoint to the next; final curve lands on the last point', () => {
    expect(emit([0, 0, 10, 0, 10, 10, 0, 10])).toEqual([
      'M 0 0',
      'Q 10 0 10 5',
      'Q 10 10 0 10',
    ]);
  });

  it('three points — a single curve from first to last', () => {
    expect(emit([0, 0, 10, 0, 10, 10])).toEqual(['M 0 0', 'Q 10 0 10 10']);
  });

  it('is deterministic: same input — same commands', () => {
    const points = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3];
    expect(emit(points)).toEqual(emit(points));
  });
});
