import { describe, expect, it } from 'bun:test';
import { emitGeometry, emitGeometryFrom, type PathSink } from './smoothing';

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

describe('emitGeometryFrom — the same path, from a segment on', () => {
  /** A line of the shape a hand draws: no two points alike. */
  const line = (count: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(i * 7 + (i % 3) * 2, i * 3 + (i % 5));
    return out;
  };

  function tail(
    points: number[],
    geometry: 'line' | 'smooth' | 'cubic',
    from: number,
    until?: number,
  ): string[] | null {
    const sink = new Sink();
    return emitGeometryFrom(points, geometry, from, sink, until) ? sink.log : null;
  }

  for (const geometry of ['line', 'smooth'] as const) {
    it(`${geometry}: the commands from the join on are the ones the whole path draws`, () => {
      const points = line(12);
      const whole = emit(points, geometry);
      for (let from = 1; from < whole.length; from++) {
        const part = tail(points, geometry, from);
        expect(part).not.toBeNull();
        // Everything after the join is command for command what the whole
        // path draws — the stroke already on the buffer is not touched.
        expect(part!.slice(1)).toEqual(whole.slice(from + 1));
        // And the part starts exactly where the whole path had got to, so the
        // join is a continuation and not a jump.
        expect(part![0]).toBe(`M ${endOf(whole[from])}`);
      }
    });
  }

  it('draws the whole path when the join is at or before the start', () => {
    const points = line(6);
    expect(tail(points, 'smooth', 0)).toEqual(emit(points, 'smooth'));
  });

  for (const geometry of ['line', 'smooth'] as const) {
    it(`${geometry}: a stretch between two joins is the same stretch of the whole path`, () => {
      // The live stroke keeps the settled part on its buffer and redraws only
      // the couple of commands still moving under the hand, so it has to be
      // able to ask for the middle of the path and get the middle of it.
      const points = line(12);
      const whole = emit(points, geometry);
      for (let from = 1; from < whole.length - 1; from++) {
        for (let until = from + 1; until < whole.length; until++) {
          const part = tail(points, geometry, from, until);
          expect(part).not.toBeNull();
          expect(part!.slice(1)).toEqual(whole.slice(from + 1, until + 1));
          expect(part![0]).toBe(`M ${endOf(whole[from])}`);
        }
      }
    });
  }

  it('draws nothing but the join when the stretch is empty', () => {
    const points = line(8);
    expect(tail(points, 'smooth', 3, 3)).toHaveLength(1);
  });

  it('refuses a geometry that cannot be joined, so the caller redraws it whole', () => {
    expect(tail([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7], 'cubic', 1)).toBeNull();
  });

  it('refuses a join past the end of the path', () => {
    expect(tail(line(4), 'smooth', 99)).toBeNull();
  });
});

/** The point a recorded command ends on. */
function endOf(command: string): string {
  const parts = command.split(' ');
  return `${parts[parts.length - 2]} ${parts[parts.length - 1]}`;
}
