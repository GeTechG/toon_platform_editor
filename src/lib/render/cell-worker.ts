// Rasterizes cells for the studio's cache off the page's thread (cell-warm.ts):
// one cell a message, with the renderer everyone draws with, handed back as a
// bitmap.

import { renderStrokesLayer, type Canvas2DLike } from './canvas2d';
import type { CellJob } from './cell-warm';

export type CellReply = { id: number; bitmap: ImageBitmap } | { id: number; failed: true };

self.onmessage = (e: MessageEvent<{ id: number; job: CellJob }>) => {
  const { id, job } = e.data;
  const post = (reply: CellReply, transfer: Transferable[] = []): void => {
    (self as unknown as Worker).postMessage(reply, transfer);
  };
  try {
    // Started only where the page found one (cell-crew.ts); asked again all the same.
    const canDraw = typeof OffscreenCanvas !== 'undefined';
    if (!canDraw) {
      post({ id, failed: true });
      return;
    }
    const canvas = new OffscreenCanvas(job.width, job.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      post({ id, failed: true });
      return;
    }
    renderStrokesLayer({ strokes: job.strokes.slice() }, job.tools, ctx as unknown as Canvas2DLike, job.viewport);
    const bitmap = canvas.transferToImageBitmap();
    post({ id, bitmap }, [bitmap]);
  } catch {
    post({ id, failed: true });
  }
};
