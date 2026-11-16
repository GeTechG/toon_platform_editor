/**
 * Reading a layer's cells. A cell is a drawing or a continuation (`null`),
 * which shows the layer's nearest drawing before it — so every reader of the
 * document goes through here instead of indexing `frames` itself.
 */

import type { Cell, Frame, Layer } from '../format/types';

/** The empty drawing a layer that somehow opens with a continuation shows. */
const NOTHING: Frame = Object.freeze({ strokes: Object.freeze([]) as unknown as Frame['strokes'] }) as Frame;

/** Index of the drawing cell `index` shows: itself, or the nearest drawing before it. */
export function keyOf(frames: readonly Cell[], index: number): number {
  let i = Math.min(index, frames.length - 1);
  while (i > 0 && frames[i] === null) i--;
  return i;
}

/**
 * The drawing a layer shows on a tick — the very object of its drawing cell, so
 * a continuation and its drawing are one thing to every cache.
 */
export function resolveCell(layer: Pick<Layer, 'frames'>, index: number): Frame {
  return layer.frames[keyOf(layer.frames, index)] ?? NOTHING;
}

/**
 * For each tick, the index of the drawing it shows — built in one pass, for
 * readers that walk the whole film (the player, exports, the onion).
 */
export function keyIndex(layer: Pick<Layer, 'frames'>): Int32Array {
  const keys = new Int32Array(layer.frames.length);
  let key = 0;
  layer.frames.forEach((frame, i) => {
    if (frame !== null) key = i;
    keys[i] = key;
  });
  return keys;
}

/** Whether cell `index` is a continuation. */
export function isContinuation(layer: Pick<Layer, 'frames'>, index: number): boolean {
  return layer.frames[index] === null;
}
