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
  const byReference = new WeakMap<object, number>();
  const byContent = new Map<string, number>();
  const twins: number[] = [];
  for (let index = 0; index < total; index++) {
    const key = layers.map((layer) => {
      const frame = layer.frames[index];
      if (!frame) return 0;
      const raster = frame.raster;
      const drawing = raster ?? frame.strokes;
      const known = byReference.get(drawing);
      if (known !== undefined) return known;
      const content = raster
        ? 'raster:' + JSON.stringify([raster.hash, raster.x, raster.y, raster.width, raster.height])
        : 'vector:' + JSON.stringify(frame.strokes);
      let identity = byContent.get(content);
      if (identity === undefined) {
        identity = byContent.size + 1;
        byContent.set(content, identity);
      }
      byReference.set(drawing, identity);
      return identity;
    }).join(',');
    if (!first.has(key)) first.set(key, index);
    twins.push(first.get(key)!);
  }
  return twins;
}
