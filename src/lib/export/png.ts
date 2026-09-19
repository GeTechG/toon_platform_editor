/**
 * Single-frame PNG export. Everything that decides what the pixels look like
 * — resolution, watermark, transparent background — lives in the shared
 * rasterizer and is unit-tested there; this is the `toBlob` around it.
 */

import type { ToonDocument } from '../format/types';
import { FrameRasterizer, type RasterizeOptions } from './rasterize';

export async function exportPng(doc: ToonDocument, options: RasterizeOptions = {}): Promise<Blob> {
  const raster = new FrameRasterizer(doc, options);
  raster.draw(0);
  return new Promise((resolve, reject) => {
    raster.canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('PNG encoding unsupported'));
      }
    }, 'image/png');
  });
}
