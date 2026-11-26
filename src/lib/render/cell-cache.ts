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
import type { PlacedStroke } from './canvas2d';
import type { Viewport } from './contract';
import type { ComposeBuffer } from './frame-compose';

/** What a cell is drawn from, stroke by stroke: points, tool, pressure and optional placement. */
export type Ink = readonly (readonly [readonly number[], ToolDescriptor | undefined, readonly number[] | undefined, (readonly number[])?])[];

/** A cell's pixels: a buffer rasterized here, or a bitmap handed in (a worker's). */
export interface CellPixels {
  readonly image: CanvasImageSource;
}

interface Entry extends CellPixels {
  readonly ink: Ink;
  readonly bytes: number;
  /** Gives the pixels back now, not when the collector gets to them. */
  readonly free: () => void;
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

export function sameInk(a: Ink, b: Ink): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const [pa, ta, ra, ma] = a[i];
    const [pb, tb, rb, mb] = b[i];
    if (!sameNumbers(pa, pb) || !sameNumbers(ra, rb) || !sameNumbers(ma, mb) || toolKey(ta) !== toolKey(tb)) return false;
  }
  return true;
}

/** Where a cell's pixels are kept, and what it is drawn from. */
export function identifyCellInk(
  cell: Frame,
  tools: readonly ToolDescriptor[],
  viewport: Viewport,
  width: number,
  height: number,
): { key: string; ink: Ink } {
  return keyOfInk(cell.strokes.map((s: Stroke) => [s.points, tools[s.tool_id], s.pressure, (s as PlacedStroke).place] as const), viewport, width, height);
}

function keyOfInk(ink: Ink, viewport: Viewport, width: number, height: number): { key: string; ink: Ink } {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (const [points, tool, pressure, place] of ink) {
    const part = arrayHash(points) ^ Math.imul(stringHash(toolKey(tool)), 31)
      ^ (pressure ? arrayHash(pressure) : 0x5bd1e995) ^ (place ? Math.imul(arrayHash(place), 17) : 0);
    h1 = Math.imul(h1 ^ part, 0x01000193);
    h2 = Math.imul(h2 + part, 0x85ebca6b) ^ (h2 >>> 13);
  }
  const key = `${width}x${height}@${viewport.scale}:${viewport.dpr}:${viewport.panX ?? 0}:${viewport.panY ?? 0}`
    + `|${ink.length}:${h1 >>> 0}:${h2 >>> 0}`;
  return { key, ink };
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
  ): CellPixels | null {
    const bytes = width * height * 4;
    if (bytes > this.#budget) {
      return null;
    }
    const { key, ink } = identifyCellInk(cell, tools, viewport, width, height);
    const kept = this.#find(key, ink);
    if (kept) {
      return kept;
    }
    const buffer = this.#make();
    buffer.size(width, height);
    buffer.clear();
    paint(buffer);
    this.#keep(key, { image: buffer.image, ink, bytes, free: () => buffer.size(0, 0) });
    return { image: buffer.image };
  }

  /**
   * Keeps pixels rasterized elsewhere (a worker's bitmap) as the cell's. Says
   * whether they were kept: not when they do not fit, nor over pixels already
   * there — those are freed instead.
   */
  put(
    cell: Frame,
    tools: readonly ToolDescriptor[],
    viewport: Viewport,
    width: number,
    height: number,
    image: CanvasImageSource,
    free: () => void,
  ): boolean {
    const bytes = width * height * 4;
    const { key, ink } = identifyCellInk(cell, tools, viewport, width, height);
    if (bytes > this.#budget || this.#find(key, ink)) {
      free();
      return false;
    }
    this.#keep(key, { image, ink, bytes, free });
    return true;
  }

  /**
   * Keeps a copy of pixels already drawn somewhere — a layer's buffer about to
   * be drawn over — as those of the strokes `ink` lists (points, tool,
   * pressure). One blit, where rasterizing them again was every line.
   */
  keepCopy(ink: Ink, viewport: Viewport, width: number, height: number, source: CanvasImageSource): void {
    const bytes = width * height * 4;
    const found = keyOfInk(ink, viewport, width, height);
    if (bytes > this.#budget || ink.length === 0 || this.#find(found.key, found.ink)) {
      return;
    }
    const buffer = this.#make();
    buffer.size(width, height);
    buffer.clear();
    buffer.ctx.setTransform(1, 0, 0, 1, 0, 0);
    buffer.ctx.drawImage(source, 0, 0);
    this.#keep(found.key, { image: buffer.image, ink: found.ink, bytes, free: () => buffer.size(0, 0) });
  }

  /** Whether the cell's pixels are kept, without rasterizing it or touching the order. */
  has(cell: Frame, tools: readonly ToolDescriptor[], viewport: Viewport, width: number, height: number): boolean {
    const { key, ink } = identifyCellInk(cell, tools, viewport, width, height);
    const kept = this.#entries.get(key);
    return kept !== undefined && sameInk(kept.ink, ink);
  }

  /**
   * Some kept pixels of the cell, whatever bitmap they were rasterized for —
   * for a picture of it, a thumbnail, that only scales them down. Null when
   * none are kept.
   */
  anyOf(cell: Frame, tools: readonly ToolDescriptor[]): CellPixels | null {
    if (cell.strokes.length === 0) {
      return null;
    }
    const { key, ink } = identifyCellInk(cell, tools, { scale: 0, dpr: 0 }, 0, 0);
    const strokes = key.slice(key.indexOf('|'));
    for (const [kept, entry] of this.#entries) {
      if (kept.endsWith(strokes) && sameInk(entry.ink, ink)) {
        return entry;
      }
    }
    return null;
  }

  /** How many cells of `width`×`height` the budget holds at all. */
  room(width: number, height: number): number {
    return Math.floor(this.#budget / Math.max(1, width * height * 4));
  }

  /** Gives every kept cell's pixels back. */
  dispose(): void {
    for (const entry of this.#entries.values()) {
      entry.free();
    }
    this.#entries.clear();
    this.#bytes = 0;
  }

  /** The kept pixels of exactly this ink, made the newest; a stale entry under the key is freed. */
  #find(key: string, ink: Ink): Entry | null {
    const kept = this.#entries.get(key);
    if (!kept) {
      return null;
    }
    this.#entries.delete(key);
    if (sameInk(kept.ink, ink)) {
      this.#entries.set(key, kept);
      return kept;
    }
    this.#bytes -= kept.bytes;
    kept.free();
    return null;
  }

  #keep(key: string, entry: Entry): void {
    while (this.#bytes + entry.bytes > this.#budget && this.#entries.size > 0) {
      const [oldest, old] = this.#entries.entries().next().value!;
      this.#entries.delete(oldest);
      this.#bytes -= old.bytes;
      old.free();
    }
    this.#entries.set(key, entry);
    this.#bytes += entry.bytes;
  }
}

const MB = 1024 * 1024;

/**
 * The budget for kept cells on a device of `deviceMemory` GB, as the browser
 * reports it (`navigator.deviceMemory`, Chrome only and never above 8): the
 * more memory, the more of a long drawing stays rasterized (owner,
 * 2026-11-14). Where it is not told — Safari, Firefox — the 64 MB a phone is
 * safe with.
 */
export function cellBudget(deviceMemory: number | undefined): number {
  if (deviceMemory !== undefined && deviceMemory >= 8) return 256 * MB;
  if (deviceMemory !== undefined && deviceMemory >= 4) return 128 * MB;
  return 64 * MB;
}
