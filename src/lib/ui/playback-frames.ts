/**
 * The frames of a playback in the studio, kept as pixels once composed.
 *
 * Every frame shown was composed from nothing: a drawing of 1800 lines a
 * frame played at 2.6 frames a second of its 6, and at 0.6 on a weak
 * processor (a sent file, 2026-11-14). Nothing is drawn while the film plays,
 * so a frame composed once is that frame for the rest of the playback — the
 * way the player keeps its own. A stop lets them all go. No more than the
 * window the device's memory allows are held (`render/playback-window.ts`,
 * owner 2026-11-16): past it, the frame due last round the loop goes.
 */

interface Sheet {
  readonly width: number;
  readonly height: number;
}

/**
 * What a played frame is kept as: a bitmap, laid with one `drawImage`, where
 * the browser makes them; pixels in Safari and on an iPhone (every browser
 * there is Safari underneath), which count bitmaps against their cap on canvas
 * memory and drop the page past it (owner, 2026-11-14: by the device).
 */
export function playbackKeeps(userAgent: string, bitmaps: boolean): 'bitmap' | 'pixels' {
  const apple = /iPhone|iPad|iPod/.test(userAgent)
    || (/Safari\//.test(userAgent) && !/Chrome\/|Chromium\/|Edg\/|Firefox\//.test(userAgent));
  return bitmaps && !apple ? 'bitmap' : 'pixels';
}

export class PlaybackFrames<P> {
  readonly #free: (pixels: P) => void;
  readonly #window: (sheet: Sheet) => number;
  #doc: object | null = null;
  #width = 0;
  #height = 0;
  readonly #frames = new Map<number, P>();

  /**
   * `free` gives a frame's pixels back as it is dropped (a bitmap's `close`);
   * `window` is how many frames of a sheet are held.
   */
  constructor(free: (pixels: P) => void = () => {}, window: (sheet: Sheet) => number = () => Infinity) {
    this.#free = free;
    this.#window = window;
  }

  /** The frame's pixels kept this playback; nothing once the document or the sheet is another. */
  get(doc: object, sheet: Sheet, frame: number): P | undefined {
    this.#settle(doc, sheet);
    return this.#frames.get(frame);
  }

  /** Keeps the frame on screen of a film of `total` frames. */
  keep(doc: object, sheet: Sheet, frame: number, pixels: P, total: number): void {
    this.#settle(doc, sheet);
    const old = this.#frames.get(frame);
    if (old !== undefined && old !== pixels) this.#free(old);
    this.#frames.set(frame, pixels);
    const window = this.#window(sheet);
    while (this.#frames.size > window) {
      // The one the loop comes round to last from here: the one just played.
      let last = frame;
      let far = -1;
      for (const index of this.#frames.keys()) {
        const distance = (((index - frame) % total) + total) % total;
        if (distance > far) {
          far = distance;
          last = index;
        }
      }
      this.#free(this.#frames.get(last) as P);
      this.#frames.delete(last);
    }
  }

  release(): void {
    this.#drop();
    this.#doc = null;
  }

  #drop(): void {
    for (const pixels of this.#frames.values()) this.#free(pixels);
    this.#frames.clear();
  }

  #settle(doc: object, { width, height }: Sheet): void {
    if (doc !== this.#doc || width !== this.#width || height !== this.#height) {
      this.#drop();
      this.#doc = doc;
      this.#width = width;
      this.#height = height;
    }
  }
}
