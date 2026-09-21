import { describe, expect, it } from 'bun:test';
import { emitGeometry, type PathSink } from './smoothing';

class Sink implements PathSink {
  log: string[] = [];
  moveTo(x: number, y: number): void {
    this.log.push(`M ${x} ${y}`);
  }
  lineTo(x: number, y: number): void {
    this.log.push(`L ${x} ${y}`);
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    this.log.push(`Q ${cx} ${cy} ${x} ${y}`);
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    this.log.push(`C ${c1x} ${c1y} ${c2x} ${c2y} ${x} ${y}`);
  }
}

function emit(points: number[], geometry: 'line' | 'smooth' | 'cubic', closed = false): string[] {
  const sink = new Sink();
  emitGeometry(points, geometry, closed, sink);
  return sink.log;
}

describe('emitGeometry — the only reader the core has', () => {
  it('line: a moveTo and a segment per following point', () => {
    expect(emit([0, 0, 10, 20, 30, 40], 'line')).toEqual(['M 0 0', 'L 10 20', 'L 30 40']);
  });

  it('smooth: control is the stored point, the segment ends on the midpoint to the next', () => {
    expect(emit([0, 0, 10, 0, 10, 10, 0, 10], 'smooth')).toEqual([
      'M 0 0',
      'Q 10 0 10 5',
      'Q 10 10 0 10',
    ]);
  });

  it('smooth: nothing to draw, a lone point, and a pair of them', () => {
    expect(emit([], 'smooth')).toEqual([]);
    expect(emit([5, 6], 'smooth')).toEqual(['M 5 6']);
    expect(emit([0, 0, 10, 20], 'smooth')).toEqual(['M 0 0', 'L 10 20']);
  });

  it('smooth: three points are one curve from the first to the last', () => {
    expect(emit([0, 0, 10, 0, 10, 10], 'smooth')).toEqual(['M 0 0', 'Q 10 0 10 10']);
  });

  it('smooth: the same points give the same commands', () => {
    const points = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3];
    expect(emit(points, 'smooth')).toEqual(emit(points, 'smooth'));
  });

  it('line: nothing to draw, and a lone point', () => {
    expect(emit([], 'line')).toEqual([]);
    expect(emit([5, 6], 'line')).toEqual(['M 5 6']);
  });

  it('smooth closed: starts on the first midpoint and wraps back through the first point', () => {
    expect(emit([0, 0, 80, 0, 80, 80, 0, 80], 'smooth', true)).toEqual([
      'M 40 0',
      'Q 80 0 80 40',
      'Q 80 80 40 80',
      'Q 0 80 0 40',
      'Q 0 0 40 0',
    ]);
  });

  it('cubic: a moveTo and one bezierCurveTo per six stored numbers', () => {
    expect(emit([0, 0, 10, 0, 20, 10, 20, 20, 20, 30, 10, 40, 0, 40], 'cubic')).toEqual([
      'M 0 0',
      'C 10 0 20 10 20 20',
      'C 20 30 10 40 0 40',
    ]);
  });

  it('cubic: a lone starting point draws nothing but the move', () => {
    expect(emit([7, 9], 'cubic')).toEqual(['M 7 9']);
  });

  it('names no brush, editor or reference application', async () => {
    const source = await Bun.file(new URL('./smoothing.ts', import.meta.url)).text();
    expect(source.toLowerCase()).not.toContain('multator');
    expect(source.toLowerCase()).not.toContain('toonio');
    expect(source.toLowerCase()).not.toContain('tonio');
  });
});
