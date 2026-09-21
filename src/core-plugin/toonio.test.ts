import { describe, expect, it } from 'bun:test';
import { emitGeometry, type PathSink } from '../lib/render/smoothing';
import { layToonioPoints, toonioRules } from './toonio';

class Sink implements PathSink {
  log: (string | number)[][] = [];
  moveTo(x: number, y: number): void {
    this.log.push(['M', x, y]);
  }
  lineTo(x: number, y: number): void {
    this.log.push(['L', x, y]);
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    this.log.push(['Q', cx, cy, x, y]);
  }
  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void {
    this.log.push(['C', a, b, c, d, x, y]);
  }
}

/**
 * The reference's own emitter (toonio.ru `Tool.Curve`), kept here rather than
 * in the editor: it is what this brush claims to reproduce, not something the
 * editor draws with. One quadratic per point with the *previous* point as the
 * control, and the `+0.01` nudge it used where two points coincided.
 */
function referenceCurve(points: readonly number[], sink: PathSink): void {
  for (let i = 2; i < points.length; i += 2) {
    const x = points[i];
    const y = points[i + 1];
    let previousX = points[i - 2];
    let previousY = points[i - 1];
    if (previousX === x && previousY === y) {
      previousX += 0.01;
      previousY += 0.01;
    }
    sink.quadraticCurveTo(previousX, previousY, (x + previousX) / 2, (y + previousY) / 2);
  }
  if (points.length === 2) {
    sink.quadraticCurveTo(points[0], points[1], points[0] + 0.01, points[1] + 0.01);
  }
}

/** The largest coordinate difference between two command streams of equal shape. */
function drift(a: (string | number)[][], b: (string | number)[][]): number {
  expect(b.map((cmd) => cmd[0])).toEqual(a.map((cmd) => cmd[0]));
  let worst = 0;
  for (let i = 0; i < a.length; i++) {
    expect(b[i].length).toBe(a[i].length);
    for (let j = 1; j < a[i].length; j++) {
      worst = Math.max(worst, Math.abs((a[i][j] as number) - (b[i][j] as number)));
    }
  }
  return worst;
}

/**
 * The reference nudged a curve by this much when two points coincided, to keep
 * its own emitter from dividing by zero. The shared reader has no such need, so
 * the endpoint of such a curve is all our line may differ by: 0.01 document
 * units is 1/800 of a logical pixel.
 */
const REFERENCE_NUDGE = 0.01;

/** Strokes as Tonio stores them: collected points plus its duplicated endpoint. */
const STORED: number[][] = [
  [10, 10, 40, 80, 90, 20, 130, 70, 130, 70],
  [3, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 41, 43],
  [0, 0, 100, 0, 100, 100, 0, 100, 0, 100],
  [5, 5, 5, 5],
];

describe('the Tonio brush carries its own rules', () => {
  const rules = toonioRules({ smooth: 3, minDistance: 3 });

  it('carries the reference numbers: it drew on the canvas the editor draws on', () => {
    expect(rules.range).toEqual({ min: 1, max: 500 });
    expect(rules.defaults).toEqual({ width: 5, smooth: 3, minDistance: 3 });
  });

  it('truncates a sample to whole logical pixels as it collects it', () => {
    expect(rules.capture([], [10.9, 20.9], 40)).toEqual([8, 16]);
  });

  it('drops a repeat inside one batch but keeps one across two', () => {
    // The reference dedups within `CreatePointData` and then appends the batch,
    // so a point repeated over the seam of two events survives.
    expect(rules.capture([], [8, 8, 8, 8, 16, 16], 40)).toEqual([8, 8, 16, 16]);
    expect(rules.capture([8, 8], [8, 8], 40)).toEqual([8, 8, 8, 8]);
  });

  it('shows the first thinning stage under the hand and both on commit', () => {
    const line = [0, 0, 8, 0, 16, 0, 24, 0, 32, 0, 40, 0, 48, 0];
    const live = rules.preview!(line);
    const committed = rules.prepare!(line, 40, 1, 1);
    expect(live.length).toBeLessThan(line.length);
    expect(committed.length).toBeLessThanOrEqual(live.length);
    // Both stages end on the duplicated endpoint the reference writes.
    for (const out of [live, committed]) {
      expect(out.slice(-4)).toEqual([48, 0, 48, 0]);
    }
  });

  it('lands a cancelled gesture, unlike a brush that simply loses it', () => {
    expect(rules.commitOnCancel).toBe(true);
  });

  it('lays its points down for the smooth reader', () => {
    expect(rules.path).toBe(layToonioPoints);
  });
});

describe('the Tonio brush lays its points down for the smooth reader', () => {
  it('repeats the first point, so the curve starts with its control on it', () => {
    expect(layToonioPoints([10, 10, 40, 80, 40, 80])).toEqual([10, 10, 10, 10, 40, 80, 40, 80]);
  });

  it('draws what the reference emitter drew, bar the coincident-point nudge', () => {
    for (const stored of STORED) {
      const reference = new Sink();
      referenceCurve(stored, reference);

      const ours = new Sink();
      emitGeometry(layToonioPoints(stored), 'smooth', false, ours);
      // The reader opens with a moveTo the reference never emitted (it leaned on
      // the canvas starting a subpath at the first control point instead).
      expect(ours.log[0]).toEqual(['M', stored[0], stored[1]]);

      expect(drift(reference.log, ours.log.slice(1))).toBeLessThanOrEqual(REFERENCE_NUDGE + 1e-9);
    }
  });
});
