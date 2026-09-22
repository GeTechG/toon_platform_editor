/**
 * A fixed number of buffers, addressed by key.
 *
 * The onion ghosts are cached by what they were drawn for, and what they were
 * drawn for includes the pan — a ghost carries the pan baked into it, so a
 * hand moving the sheet misses the cache on every frame. Missing has to cost a
 * redraw and nothing else: a miss that made a new canvas meant a full-stage
 * backing store per ghost per frame of the gesture, which on a phone is tens
 * of megabytes a second handed to the collector.
 *
 * So the buffers are made once and the ring hands them out: a key it holds
 * gets its own back, a key it does not takes the slot of whatever was seen
 * longest ago.
 */
export class BufferRing<T> {
  /** Keys in the order they were last taken, oldest first. */
  readonly #keys: string[] = [];
  readonly #slots = new Map<string, T>();

  constructor(
    private readonly size: number,
    private readonly make: () => T,
  ) {}

  /**
   * The buffer for `key`. `fresh` says it holds something else and has to be
   * drawn into.
   */
  take(key: string): { buffer: T; fresh: boolean } {
    const held = this.#slots.get(key);
    if (held !== undefined) {
      this.#touch(key);
      return { buffer: held, fresh: false };
    }
    const buffer = this.#free();
    this.#slots.set(key, buffer);
    this.#keys.push(key);
    return { buffer, fresh: true };
  }

  /** A buffer nothing is holding: a new one until the ring is full, then the oldest slot. */
  #free(): T {
    if (this.#slots.size < this.size) {
      return this.make();
    }
    const oldest = this.#keys.shift()!;
    const buffer = this.#slots.get(oldest)!;
    this.#slots.delete(oldest);
    return buffer;
  }

  #touch(key: string): void {
    const at = this.#keys.indexOf(key);
    if (at >= 0) {
      this.#keys.splice(at, 1);
      this.#keys.push(key);
    }
  }
}
