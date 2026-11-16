/**
 * A film as stills: runs of ticks on which every layer shows the same
 * drawings, folded into one frame that lasts the run. It is what a viewer of
 * the whole film wants — the player, GIF, WebP and video — and what they got
 * before the format had continuations (v7 `holds`): a pause of 99 ticks is
 * one frame to rasterize and one frame in the file, not 99.
 */

import type { ToonDocument } from '../format/types';
import { keyIndex } from './cells';

export interface Stills {
  /** The film with one column per still, every cell a drawing. */
  readonly film: ToonDocument;
  /** Ticks each still lasts; absent when every still is one tick. */
  readonly holds?: number[];
  /** The tick each still begins on. */
  readonly starts: number[];
}

export function stills(doc: ToonDocument): Stills {
  const keys = doc.layers.map(keyIndex);
  const ticks = doc.layers[0].frames.length;
  const starts: number[] = [];
  for (let t = 0; t < ticks; t++) {
    if (t === 0 || keys.some((layer) => layer[t] !== layer[t - 1])) starts.push(t);
  }
  const holds = starts.map((start, i) => (starts[i + 1] ?? ticks) - start);
  const film: ToonDocument = {
    ...doc,
    // The drawings themselves, not copies: a still is read, never written.
    layers: doc.layers.map((layer, l) => ({ ...layer, frames: starts.map((t) => layer.frames[keys[l][t]]) })),
  };
  return { film, starts, ...(holds.some((hold) => hold > 1) ? { holds } : {}) };
}

/**
 * The tick the still of `tick` begins on: back over the ticks on which every
 * layer continues. A playback that keeps its frames by tick keeps one picture
 * for a pause under this key, not one per tick of it.
 */
export function stillStart(doc: ToonDocument, tick: number): number {
  let t = tick;
  while (t > 0 && doc.layers.every((layer) => layer.frames[t] === null)) t--;
  return t;
}
