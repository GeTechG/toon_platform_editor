/**
 * Main-thread side of GIF export: rasterizes document frames through the
 * existing Canvas2DFrameRenderer (same stroke path as the canvas), then
 * hands the RGBA buffers to the encoding worker.
 */

import { FIXED_POINT_SCALE } from '../format/constants';
import type { ToonDocument } from '../format/types';
import { frameCount } from '../model/operations';
import { Canvas2DFrameRenderer } from '../render/canvas2d';
import type { Canvas2DLike } from '../render/canvas2d';
import type { ExportRequest, ExportResponse } from './worker';

/**
 * Renders every frame in playback order at the logical canvas size,
 * flattened onto opaque white (the renderer clears to BACKGROUND_COLOR).
 */
export function rasterizeDocument(doc: ToonDocument): ExportRequest['frames'] {
  const width = Math.max(1, Math.round(doc.width / FIXED_POINT_SCALE));
  const height = Math.max(1, Math.round(doc.height / FIXED_POINT_SCALE));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('canvas 2d context unavailable');
  }
  const renderer = new Canvas2DFrameRenderer();
  const viewport = { scale: 1 / FIXED_POINT_SCALE, dpr: 1 };
  return Array.from({ length: frameCount(doc) }, (_, index) => {
    renderer.render(doc, index, ctx as unknown as Canvas2DLike, viewport);
    return { data: ctx.getImageData(0, 0, width, height).data.buffer as ArrayBuffer, width, height };
  });
}

/** Rasterizes the document and encodes it to GIF bytes in a Web Worker. */
export function exportGif(
  doc: ToonDocument,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const frames = rasterizeDocument(doc);
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const done = (settle: () => void) => {
      worker.terminate();
      settle();
    };
    worker.onmessage = (e: MessageEvent<ExportResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        onProgress?.(msg.done, msg.total);
      } else if (msg.type === 'done') {
        done(() => resolve(new Uint8Array(msg.bytes)));
      } else {
        done(() => reject(new Error(msg.message)));
      }
    };
    worker.onerror = () => done(() => reject(new Error('GIF export worker failed')));
    worker.postMessage(
      { frames, fps: doc.frame_rate } satisfies ExportRequest,
      frames.map((f) => f.data),
    );
  });
}
