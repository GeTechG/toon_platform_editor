/**
 * Strokes' built paths, kept to be drawn again (owner, 2026-11-14), within a
 * budget. A `Path2D` lives outside the script's heap and a pressured outline
 * is big: kept for every stroke of a heavy toon they came to 7.6 GB on the
 * toon's page (2026-11-15, 4 million points). So only what is drawn again and
 * again keeps them — the studio's canvas, at most what the device can spare,
 * the longest unused let go first — and what draws a stroke once (the player,
 * exports, thumbnails) keeps none.
 */

import type { ToolDescriptor } from '../format/types';

/**
 * What a stroke's paths are taken to weigh, in bytes: measured on a
 * pressured outline (about 1.9 KB a point in Chrome), a guess for a plain
 * path, which holds the points and little else.
 */
export function pathCost(points: readonly number[], pressure?: readonly number[]): number {
  return 256 + (points.length / 2) * (pressure ? 2048 : 64);
}

interface Kept<P> {
  readonly tool: ToolDescriptor;
  readonly pressure?: readonly number[];
  readonly paths: P;
}

export class PathKeeper<P> {
  readonly #budget: number;
  /** By points array (never edited in place); oldest use first. */
  readonly #kept = new Map<readonly number[], { entries: Kept<P>[]; bytes: number }>();
  #bytes = 0;

  constructor(budget: number) {
    this.#budget = budget;
  }

  /** What is kept now, in bytes by [`pathCost`]. */
  get bytes(): number {
    return this.#bytes;
  }

  /** The stroke's paths: kept ones, or `build`'s, kept if they fit. */
  take(points: readonly number[], tool: ToolDescriptor, pressure: readonly number[] | undefined, build: () => P): P {
    const kept = this.#kept.get(points);
    const found = kept?.entries.find((entry) => entry.tool === tool && entry.pressure === pressure);
    if (kept) {
      // Used now: to the back of the line.
      this.#kept.delete(points);
      this.#kept.set(points, kept);
    }
    if (found) {
      return found.paths;
    }
    const paths = build();
    const cost = pathCost(points, pressure);
    if (cost > this.#budget) {
      return paths;
    }
    const slot = kept ?? { entries: [], bytes: 0 };
    slot.entries.push({ tool, pressure, paths });
    slot.bytes += cost;
    this.#kept.set(points, slot);
    this.#bytes += cost;
    for (const [oldest, { bytes }] of this.#kept) {
      if (this.#bytes <= this.#budget) break;
      if (oldest === points) continue;
      this.#kept.delete(oldest);
      this.#bytes -= bytes;
    }
    return paths;
  }
}
