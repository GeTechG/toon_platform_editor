// A frame held by copying it is the same drawing in frames side by side. The
// player rasterizes it once: every frame knows the first that looks the same.

import type { ToonDocument } from '../format/types';

/**
 * For every frame of the film, the first frame drawn exactly as it is: the
 * same strokes on every visible layer, in the same order. A frame unlike any
 * before it is its own.
 */
export function frameTwins(doc: ToonDocument): number[] {
  const layers = doc.layers.filter((layer) => !layer.hidden);
  const total = doc.layers[0]?.frames.length ?? 0;
  const first = new Map<string, number>();
  const twins: number[] = [];
  for (let index = 0; index < total; index++) {
    const key = JSON.stringify(layers.map((layer) => layer.frames[index]?.strokes ?? null));
    if (!first.has(key)) first.set(key, index);
    twins.push(first.get(key)!);
  }
  return twins;
}
