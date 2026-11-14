/**
 * The frames of a playback in the studio, kept as pixels once composed.
 *
 * Every frame shown was composed from nothing: a drawing of 1800 lines a
 * frame played at 2.6 frames a second of its 6, and at 0.6 on a weak
 * processor (a sent file, 2026-11-14). Nothing is drawn while the film plays,
 * so a frame composed once is that frame for the rest of the playback — the
 * way the player keeps its own. A stop lets them all go.
 */

interface Sheet {
  readonly width: number;
  readonly height: number;
}

export class PlaybackFrames<P> {
  #doc: object | null = null;
  #width = 0;
  #height = 0;
  readonly #frames = new Map<number, P>();

  /** The frame's pixels kept this playback; nothing once the document or the sheet is another. */
  get(doc: object, sheet: Sheet, frame: number): P | undefined {
    this.#settle(doc, sheet);
    return this.#frames.get(frame);
  }

  keep(doc: object, sheet: Sheet, frame: number, pixels: P): void {
    this.#settle(doc, sheet);
    this.#frames.set(frame, pixels);
  }

  release(): void {
    this.#frames.clear();
    this.#doc = null;
  }

  #settle(doc: object, { width, height }: Sheet): void {
    if (doc !== this.#doc || width !== this.#width || height !== this.#height) {
      this.#frames.clear();
      this.#doc = doc;
      this.#width = width;
      this.#height = height;
    }
  }
}
