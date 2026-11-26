import { expect, it } from 'bun:test';
import { RoundTurnSink } from './curve-stroke';
import type { PathSink } from './smoothing';

class RecordedPath implements PathSink {
  readonly vertices: [number, number][] = [];
  readonly curves: number[][] = [];

  moveTo(x: number, y: number): void { this.vertices.push([x, y]); }
  lineTo(x: number, y: number): void { this.vertices.push([x, y]); }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void { this.curves.push([cx, cy, x, y]); }
  bezierCurveTo(ax: number, ay: number, bx: number, by: number, x: number, y: number): void {
    this.curves.push([ax, ay, bx, by, x, y]);
  }
}

it('keeps a long cubic with a tight turn within one document unit of its centreline', () => {
  const path = new RecordedPath();
  const sink = new RoundTurnSink(path, 8);
  sink.moveTo(0, 0);
  sink.bezierCurveTo(0, 1, 30_000, 0, 0, 30_000);
  expect(path.curves).toEqual([]);
  expect(path.vertices.at(-1)).toEqual([0, 30_000]);

  // The exact point on the original cubic at t = 43/64.
  const x = 218413125 / 16384;
  const y = 2385266889 / 262144;
  let distance = Infinity;
  for (let i = 1; i < path.vertices.length; i++) {
    const [ax, ay] = path.vertices[i - 1];
    const [bx, by] = path.vertices[i];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    distance = Math.min(distance, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  expect(distance).toBeLessThanOrEqual(1);
});

it('preserves a gentle quadratic and rounds the tight turn that follows it', () => {
  const path = new RecordedPath();
  const sink = new RoundTurnSink(path, 40);
  sink.moveTo(0, 0);
  sink.quadraticCurveTo(100, 5, 200, 0);
  sink.quadraticCurveTo(220, 0, 200, 1);
  expect(path.curves).toEqual([[100, 5, 200, 0]]);
  expect(path.vertices.some(([x]) => x >= 210)).toBe(true);
  expect(path.vertices.at(-1)).toEqual([200, 1]);
});
