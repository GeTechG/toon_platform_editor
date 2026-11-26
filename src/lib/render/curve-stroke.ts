import type { PathSink } from './smoothing';

const COS_30_SQUARED = 0.75;
const MIN_STEPS = 4;

/**
 * Gecko's accelerated Canvas2D stroker can leave the outside of a tight
 * Bézier turn uncovered (Mozilla bug 2084919). Explicit line segments go
 * through its round-join code. Keep the original curves elsewhere.
 */
export class RoundTurnSink implements PathSink {
  #x = 0;
  #y = 0;
  #segments = 0;
  readonly #widthSquared: number;

  /** Higher precision lowers the permitted error in document units. */
  constructor(private readonly sink: PathSink, width: number, private readonly precision = 1) {
    this.#widthSquared = width * width;
  }

  get flattenedSegments(): number {
    return this.#segments;
  }

  moveTo(x: number, y: number): void {
    this.sink.moveTo(x, y);
    this.#x = x;
    this.#y = y;
  }

  lineTo(x: number, y: number): void {
    this.sink.lineTo(x, y);
    this.#x = x;
    this.#y = y;
  }

  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    const ax = cx - this.#x, ay = cy - this.#y;
    const bx = x - cx, by = y - cy;
    if (this.#tight(ax, ay, bx, by)) {
      const steps = this.#subdivisions(Math.hypot(bx - ax, by - ay) / 4);
      this.#segments += steps;
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        this.sink.lineTo(
          u * u * this.#x + 2 * u * t * cx + t * t * x,
          u * u * this.#y + 2 * u * t * cy + t * t * y,
        );
      }
      this.lineTo(x, y);
      return;
    }
    this.sink.quadraticCurveTo(cx, cy, x, y);
    this.#x = x;
    this.#y = y;
  }

  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    const ax = c1x - this.#x, ay = c1y - this.#y;
    const bx = c2x - c1x, by = c2y - c1y;
    const cx = x - c2x, cy = y - c2y;
    if (this.#tight(ax, ay, bx, by) || this.#tight(bx, by, cx, cy) || this.#tight(ax, ay, cx, cy)) {
      const steps = this.#subdivisions(0.75 * Math.max(Math.hypot(bx - ax, by - ay), Math.hypot(cx - bx, cy - by)));
      this.#segments += steps;
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
        this.sink.lineTo(a * this.#x + b * c1x + c * c2x + d * x, a * this.#y + b * c1y + c * c2y + d * y);
      }
      this.lineTo(x, y);
      return;
    }
    this.sink.bezierCurveTo(c1x, c1y, c2x, c2y, x, y);
    this.#x = x;
    this.#y = y;
  }

  /** A turn over 30° with a control polygon leg within one brush width. */
  #tight(ax: number, ay: number, bx: number, by: number): boolean {
    const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by;
    if (a2 === 0 || b2 === 0 || (a2 > this.#widthSquared && b2 > this.#widthSquared)) return false;
    const dot = ax * bx + ay * by;
    return dot < 0 || dot * dot < COS_30_SQUARED * a2 * b2;
  }

  #subdivisions(deviation: number): number {
    // The chord error falls with the square of the subdivision count.
    return Math.max(MIN_STEPS, Math.ceil(Math.sqrt(deviation * this.precision)));
  }
}
