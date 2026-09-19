/**
 * Main-thread side of GIF export: frames come from the shared rasterizer
 * (resolution, watermark and background live there), the RGBA buffers go to
 * the encoding worker.
 */

import type { ToonDocument } from '../format/types';
import {
  rasterizeDocument,
  throwIfAborted,
  type ExportStage,
  type RasterizeOptions,
} from './rasterize';
import type { ExportRequest, ExportResponse } from './worker';

export interface ExportGifOptions extends RasterizeOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, stage: ExportStage) => void;
}

/** Rasterizes the document and encodes it to GIF bytes in a Web Worker. */
export async function exportGif(
  doc: ToonDocument,
  { signal, onProgress, ...raster }: ExportGifOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const frames = await rasterizeDocument(doc, {
    ...raster,
    signal,
    onProgress: (done, total) => onProgress?.(done, total, 'render'),
  });
  throwIfAborted(signal);
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const done = (settle: () => void) => {
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
      settle();
    };
    function onAbort(): void {
      done(() => reject(new DOMException('экспорт отменён', 'AbortError')));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (e: MessageEvent<ExportResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        onProgress?.(msg.done, msg.total, 'encode');
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
