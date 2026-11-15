// One of the crew that rasterizes a film for the player (`warm.ts`): draws its
// share of the frames with the renderer everyone draws with, into the bitmap
// of the sheet, and hands the pixels back.

import { FIXED_POINT_SCALE } from '../format/constants';
import { Canvas2DFrameRenderer, type Canvas2DLike } from '../render/canvas2d';
import { sheetRaster } from '../ui/viewport';
import type { WarmOrder, WarmReport } from './warm';

const post = (report: WarmReport, transfer: Transferable[] = []): void => {
  (self as unknown as Worker).postMessage(report, transfer);
};

let canvas: OffscreenCanvas | null = null;

/** The sheet's bitmap, kept from order to order: an order is a frame at a time. */
function sheet(width: number, height: number): OffscreenCanvasRenderingContext2D | null {
  if (!canvas || canvas.width !== width || canvas.height !== height) {
    canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : null;
  }
  if (!canvas) return null;
  // Made for reading back: every frame drawn on it is read once and handed on.
  return canvas.getContext('2d', { willReadFrequently: true });
}

self.onmessage = (e: MessageEvent<WarmOrder>) => {
  const { doc, frames } = e.data;
  const raster = sheetRaster(doc);
  const ctx = sheet(raster.width, raster.height);
  if (!ctx) {
    post({ done: true, ok: false });
    return;
  }
  const renderer = new Canvas2DFrameRenderer();
  const viewport = { scale: raster.level / FIXED_POINT_SCALE, dpr: 1 };
  try {
    for (const index of frames) {
      renderer.render(doc, index, ctx as unknown as Canvas2DLike, viewport);
      const frame = ctx.getImageData(0, 0, raster.width, raster.height);
      post({ index, frame }, [frame.data.buffer]);
    }
  } catch {
    // No room for another frame, or a stroke the renderer will not draw: the
    // page has what came before and deals with the rest as it would alone.
    post({ done: true, ok: false });
    return;
  }
  post({ done: true, ok: true });
};
