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
  onFrame: (frameIndex: number) => void;
}

export class LoopPlayer {
  readonly #frameCount: number;
  readonly #intervalMs: number;
  readonly #startFrame: number;
  readonly #onFrame: (frameIndex: number) => void;
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
    this.#frameCount = options.frameCount;
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
    this.#current = (this.#current + steps) % this.#frameCount;
    this.#last = nowMs - (delta % this.#intervalMs);
    this.#onFrame(this.#current);
  }

  /** Stops playback; returns the frame playback started from. */
  stop(): number {
    return this.#startFrame;
  }
}
