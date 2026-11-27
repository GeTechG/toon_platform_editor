import { FIXED_POINT_SCALE, SCHEMA_VERSION } from './constants';
import type { RasterCel, ToonDocument } from './types';
import { loadDocument } from './validate';

export function hasRasterLayers(doc: ToonDocument): boolean {
  return doc.layers.some((layer) => layer.kind === 'raster');
}

/** A sorted inventory gives the project archive an unambiguous file order. */
export function rasterInventory(doc: ToonDocument): [string, RasterCel][] {
  const cells = new Map<string, RasterCel>();
  for (const layer of doc.layers) {
    for (const frame of layer.frames) {
      if (frame?.raster) cells.set(frame.raster.hash, frame.raster);
    }
  }
  return [...cells.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}

export function rasterSheetSize(doc: Pick<ToonDocument, 'width' | 'height'>): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(doc.width / FIXED_POINT_SCALE)),
    height: Math.max(1, Math.round(doc.height / FIXED_POINT_SCALE)),
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** Validate the vector contract and the local extensions independently. */
export function loadStudioDocument(data: unknown, { owned = false } = {}): ToonDocument {
  if (!object(data) || data.schema_version !== SCHEMA_VERSION || !Array.isArray(data.layers) ||
      !data.layers.some((layer: unknown) => object(layer) && layer.kind === 'raster')) {
    return loadDocument(data, { owned });
  }
  const rasterLayers = new Map<number, Map<number, RasterCel>>();
  const seen = new Map<string, RasterCel>();
  const layers = data.layers.map((layer: unknown, layerIndex: number) => {
    if (!object(layer) || layer.kind !== 'raster') return layer;
    if (!Array.isArray(layer.frames)) throw new Error('Raster layer has no frames');
    const { kind: _kind, frames, ...vectorLayer } = layer;
    const cels = new Map<number, RasterCel>();
    rasterLayers.set(layerIndex, cels);
    return {
      ...vectorLayer,
      frames: frames.map((frame: unknown, frameIndex: number) => {
        if (frame === null) return null;
        if (!object(frame) || !Array.isArray(frame.strokes) || frame.strokes.length !== 0) {
          throw new Error('Raster frame must contain an empty stroke list');
        }
        const { raster, ...vectorFrame } = frame;
        if (raster !== undefined) {
          if (!object(raster) || Object.keys(raster).length !== 5) throw new Error('Invalid raster crop');
          const { hash, x, y, width, height } = raster;
          if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash) ||
              !integer(x) || !integer(y) || !integer(width) || !integer(height) ||
              x < 0 || y < 0 || width < 1 || height < 1) throw new Error('Invalid raster crop');
          const cel = { hash, x, y, width, height };
          const previous = seen.get(hash);
          if (previous && (previous.width !== width || previous.height !== height)) {
            throw new Error('Conflicting raster dimensions');
          }
          seen.set(hash, cel);
          cels.set(frameIndex, cel);
        }
        return vectorFrame;
      }),
    };
  });
  const doc = loadDocument({ ...data, layers }, { owned });
  const sheet = rasterSheetSize(doc);
  for (const [layerIndex, cels] of rasterLayers) {
    const layer = doc.layers[layerIndex];
    layer.kind = 'raster';
    for (const [frameIndex, cel] of cels) {
      if (cel.x + cel.width > sheet.width || cel.y + cel.height > sheet.height) {
        throw new Error('Raster crop exceeds the sheet');
      }
      layer.frames[frameIndex]!.raster = cel;
    }
  }
  return doc;
}
