/**
 * Loop playback logic: a time accumulator over external ticks (the UI
 * wires up rAF). The rate is not tied to the render rate and does not drift:
 * last = now − delta % interval.
 */

export interface LoopPlayerOptions {
  frameCount: number;
  /** Frames per second (≥ 1). */
  fps: number;
  /** Frame playback starts from (and returns to on stop). */
  startFrame: number;
  /**
   * The stretch the loop runs over; the whole document by default. A frame
   * selection narrows it, and `startFrame` may sit anywhere inside it —
   * Shift+Space begins at the active frame and still wraps to `loopStart`.
   */
  loopStart?: number;
  loopEnd?: number;
  /**
   * `lapped`: the step went past the loop's end. The frame number alone does
   * not say so — a hitch of a whole lap lands on the frame it left.
   */
  onFrame: (frameIndex: number, lapped: boolean) => void;
}

export class LoopPlayer {
  readonly #loopStart: number;
  readonly #loopLength: number;
  readonly #intervalMs: number;
  readonly #startFrame: number;
  readonly #onFrame: (frameIndex: number, lapped: boolean) => void;
  #current: number;
  #last: number | null = null;

  constructor(options: LoopPlayerOptions) {
    if (!Number.isInteger(options.frameCount) || options.frameCount < 1) {
      throw new RangeError(`frameCount must be an integer ≥ 1, got ${options.frameCount}`);
    }
    if (!Number.isFinite(options.fps) || options.fps < 1) {
      throw new RangeError(`fps must be ≥ 1, got ${options.fps}`);
    }
    if (
      !Number.isInteger(options.startFrame) ||
      options.startFrame < 0 ||
      options.startFrame >= options.frameCount
    ) {
      throw new RangeError(`startFrame ${options.startFrame} is out of range 0..${options.frameCount - 1}`);
    }
    const loopStart = options.loopStart ?? 0;
    const loopEnd = options.loopEnd ?? options.frameCount - 1;
    if (
      !Number.isInteger(loopStart) ||
      !Number.isInteger(loopEnd) ||
      loopStart < 0 ||
      loopEnd >= options.frameCount ||
      loopStart > loopEnd ||
      options.startFrame < loopStart ||
      options.startFrame > loopEnd
    ) {
      throw new RangeError(
        `loop range ${loopStart}..${loopEnd} is not a stretch of 0..${options.frameCount - 1} holding ${options.startFrame}`,
      );
    }
    this.#loopStart = loopStart;
    this.#loopLength = loopEnd - loopStart + 1;
    this.#intervalMs = 1000 / options.fps;
    this.#startFrame = options.startFrame;
    this.#current = options.startFrame;
    this.#onFrame = options.onFrame;
  }

  get currentFrame(): number {
    return this.#current;
  }

  /** Tick with a timestamp (performance.now / rAF timestamp), ms. */
  tick(nowMs: number): void {
    if (this.#last === null) {
      this.#last = nowMs;
      return;
    }
    const delta = nowMs - this.#last;
    if (delta < this.#intervalMs) {
      return;
    }
    const steps = Math.floor(delta / this.#intervalMs);
    const reach = this.#current - this.#loopStart + steps;
    this.#current = this.#loopStart + (reach % this.#loopLength);
    this.#last = nowMs - (delta % this.#intervalMs);
    this.#onFrame(this.#current, reach >= this.#loopLength);
  }

  /** Stops playback; returns the frame playback started from. */
  stop(): number {
    return this.#startFrame;
  }
}
