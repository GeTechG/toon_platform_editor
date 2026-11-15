// The player's frames, rasterized ahead of the clock. A frame of a film is
// every stroke of every layer drawn again; shown from here it is one copy of
// pixels. Pure — the player decides what a frame is and how it is drawn.
//
// It holds the window of frames the device's memory allows
// (`render/playback-window.ts`): the whole film when it fits, else the frames
// ahead of the one on screen, the played ones let go (owner, 2026-11-16 —
// the ceiling turned down on 2026-10-10 came back for films longer than it). A
// device that cannot hold even that says so when a frame is taken, and the
// player draws the rest live.

export class FrameCache<T> {
  readonly #frames = new Map<number, T>();
  #of: object | null = null;
  #width = 0;
  #height = 0;

  /** What the frames are drawn from and at what size. A change starts it over. */
  fit(of: object, width: number, height: number): void {
    if (of === this.#of && width === this.#width && height === this.#height) {
      return;
    }
    this.#frames.clear();
    this.#of = of;
    this.#width = width;
    this.#height = height;
  }

  get(index: number): T | undefined {
    return this.#frames.get(index);
  }

  put(index: number, frame: T): void {
    this.#frames.set(index, frame);
  }

  /** Lets go of every frame but `keep`'s. */
  trim(keep: Iterable<number>): void {
    const kept = new Set(keep);
    for (const index of [...this.#frames.keys()]) {
      if (!kept.has(index)) this.#frames.delete(index);
    }
  }

  /**
   * The frame to rasterize next: the first not held yet, from the one on
   * screen onwards and round, within `window` frames of it. Null when all of
   * them are held.
   */
  next(total: number, from: number, window = total): number | null {
    for (let step = 0; step < Math.min(total, window); step++) {
      const index = (from + step) % total;
      if (!this.#frames.has(index)) {
        return index;
      }
    }
    return null;
  }

  /** How much of the film is held, 0…1 — the loading the viewer waits out. */
  progress(total: number): number {
    return total > 0 ? Math.min(1, this.#frames.size / total) : 1;
  }

  clear(): void {
    this.#frames.clear();
  }
}
