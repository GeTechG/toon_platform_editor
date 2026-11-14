/**
 * Cells of layers rasterized once, kept by what they hold.
 *
 * A drawing whose sketch layer is copied into every frame (a file read back
 * makes every copy an object of its own) rasterized that sketch anew at every
 * step through the frames: 893 lines of it, on a weak processor seconds a
 * step (a sent file, 2026-11-14). Kept here, a cell with the same strokes in
 * the same order — the same points, pressure and tools, under the same bitmap
 * — is rasterized once and laid as pixels everywhere else: in another frame,
 * after an undo, in a ghost.
 *
 * Whether two cells hold the same is read off their content, not their
 * identity, and a hash only finds the candidate: the strokes are compared
 * before its pixels are trusted.
 */

import type { Frame, Stroke, ToolDescriptor } from '../format/types';
import type { Viewport } from './contract';
import type { ComposeBuffer } from './frame-compose';

/** What a cell is drawn from, stroke by stroke: points, tool, pressure. */
type Ink = readonly (readonly [readonly number[], ToolDescriptor | undefined, readonly number[] | undefined])[];

interface Entry {
  readonly buffer: ComposeBuffer;
  readonly ink: Ink;
  readonly bytes: number;
}

const arrayHashes = new WeakMap<readonly number[], number>();
const toolKeys = new WeakMap<object, string>();

/** FNV-1a over the numbers of an array, kept per array: the points of a stroke are not edited in place. */
function arrayHash(values: readonly number[]): number {
  let hash = arrayHashes.get(values);
  if (hash === undefined) {
    hash = 0x811c9dc5;
    for (const value of values) {
      hash = Math.imul(hash ^ (Math.round(value * 1024) | 0), 0x01000193);
    }
    hash >>>= 0;
    arrayHashes.set(values, hash);
  }
  return hash;
}

function toolKey(tool: ToolDescriptor | undefined): string {
  if (!tool) return '';
  let key = toolKeys.get(tool);
  if (key === undefined) {
    key = JSON.stringify(tool);
    toolKeys.set(tool, key);
  }
  return key;
}

function stringHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return hash >>> 0;
}

function sameNumbers(a: readonly number[] | undefined, b: readonly number[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function sameInk(a: Ink, b: Ink): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const [pa, ta, ra] = a[i];
    const [pb, tb, rb] = b[i];
    if (!sameNumbers(pa, pb) || !sameNumbers(ra, rb) || toolKey(ta) !== toolKey(tb)) return false;
  }
  return true;
}

export class CellCache {
  readonly #make: () => ComposeBuffer;
  readonly #budget: number;
  /** In the order they were last needed, the longest unneeded first. */
  readonly #entries = new Map<string, Entry>();
  #bytes = 0;

  constructor(make: () => ComposeBuffer, budget: number) {
    this.#make = make;
    this.#budget = budget;
  }

  /**
   * The cell's pixels in a transparent buffer of `width`×`height`: kept ones,
   * or `paint` asked to rasterize it now. Null when a cell of that size does
   * not fit the budget at all; the caller draws it as it did before.
   */
  take(
    cell: Frame,
    tools: readonly ToolDescriptor[],
    viewport: Viewport,
    width: number,
    height: number,
    paint: (buffer: ComposeBuffer) => void,
  ): ComposeBuffer | null {
    const bytes = width * height * 4;
    if (bytes > this.#budget) {
      return null;
    }
    const ink: Ink = cell.strokes.map((s: Stroke) => [s.points, tools[s.tool_id], s.pressure] as const);
    let h1 = 0x811c9dc5;
    let h2 = 0x9e3779b9;
    for (const [points, tool, pressure] of ink) {
      const part = arrayHash(points) ^ Math.imul(stringHash(toolKey(tool)), 31) ^ (pressure ? arrayHash(pressure) : 0x5bd1e995);
      h1 = Math.imul(h1 ^ part, 0x01000193);
      h2 = Math.imul(h2 + part, 0x85ebca6b) ^ (h2 >>> 13);
    }
    const key = `${width}x${height}@${viewport.scale}:${viewport.dpr}:${viewport.panX ?? 0}:${viewport.panY ?? 0}`
      + `|${ink.length}:${h1 >>> 0}:${h2 >>> 0}`;
    const kept = this.#entries.get(key);
    if (kept) {
      this.#entries.delete(key);
      if (sameInk(kept.ink, ink)) {
        this.#entries.set(key, kept);
        return kept.buffer;
      }
      this.#bytes -= kept.bytes;
      kept.buffer.size(0, 0);
    }
    while (this.#bytes + bytes > this.#budget) {
      const [oldest, entry] = this.#entries.entries().next().value!;
      this.#entries.delete(oldest);
      this.#bytes -= entry.bytes;
      entry.buffer.size(0, 0);
    }
    const buffer = this.#make();
    buffer.size(width, height);
    buffer.clear();
    paint(buffer);
    this.#entries.set(key, { buffer, ink, bytes });
    this.#bytes += bytes;
    return buffer;
  }

  /** Gives every kept buffer's pixels back. */
  dispose(): void {
    for (const entry of this.#entries.values()) {
      entry.buffer.size(0, 0);
    }
    this.#entries.clear();
    this.#bytes = 0;
  }
}
