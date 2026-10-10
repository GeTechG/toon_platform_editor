// The player's frames, rasterized ahead of the clock. A frame of a film is
// every stroke of every layer drawn again; shown from here it is one copy of
// pixels. Pure — the player decides what a frame is and how it is drawn.

/**
 * How much the rasterized frames may weigh, bytes. The calibration knob: a
 * film longer than this holds is drawn stroke by stroke past it, as before.
 */
export const FRAME_CACHE_BYTES = 192 * 1024 * 1024;

export class FrameCache<T> {
  readonly #budget: number;
  readonly #frames = new Map<number, T>();
  #of: object | null = null;
  #width = 0;
  #height = 0;
  #room = 0;

  constructor(budget = FRAME_CACHE_BYTES) {
    this.#budget = budget;
  }

  /** What the frames are drawn from and at what size. A change starts it over. */
  fit(of: object, width: number, height: number): void {
    if (of === this.#of && width === this.#width && height === this.#height) {
      return;
    }
    this.#frames.clear();
    this.#of = of;
    this.#width = width;
    this.#height = height;
    this.#room = Math.floor(this.#budget / (width * height * 4));
  }

  get(index: number): T | undefined {
    return this.#frames.get(index);
  }

  /** Keeps the frame if there is room for it; says whether it did. */
  put(index: number, frame: T): boolean {
    if (!this.#frames.has(index) && this.#frames.size >= this.#room) {
      return false;
    }
    this.#frames.set(index, frame);
    return true;
  }

  /**
   * The frame to rasterize next: the first not held yet, from the one on
   * screen onwards and round. Null when all are held or there is no room.
   */
  next(total: number, from: number): number | null {
    if (this.#frames.size >= this.#room) {
      return null;
    }
    for (let step = 0; step < total; step++) {
      const index = (from + step) % total;
      if (!this.#frames.has(index)) {
        return index;
      }
    }
    return null;
  }

  clear(): void {
    this.#frames.clear();
  }
}
