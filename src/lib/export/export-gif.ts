/**
 * Main-thread side of GIF export: frames come from the shared rasterizer
 * (resolution, watermark and background live there) and go to the encoding
 * worker one at a time, each buffer transferred rather than copied.
 *
 * The animation is never assembled. One palette for the whole film has to be
 * known before the first frame is encoded, so the document is drawn twice:
 * once for the colours, once for the bytes. That is the price of not holding
 * 880 MB of RGBA on a phone that has 2 GB in total.
 */

import type { ToonDocument } from '../format/types';
import { frameCount } from '../model/operations';
import {
  exportSize,
  logicalSize,
  rasterizeFrames,
  throwIfAborted,
  type ExportStage,
  type RasterizeOptions,
} from './rasterize';
import type { ExportRequest, ExportResponse } from './worker';
import { t } from '../i18n';

/** Frames of pass two handed to the worker ahead of the one it is encoding. */
const FRAMES_IN_FLIGHT = 2;

export interface ExportGifOptions extends RasterizeOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, stage: ExportStage) => void;
}

/** Rasterizes the document and encodes it to GIF bytes in a Web Worker. */
export async function exportGif(
  doc: ToonDocument,
  { signal, onProgress, ...raster }: ExportGifOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const size = exportSize(doc, raster.width ?? logicalSize(doc).width);
  const total = frameCount(doc);

  const send = (msg: ExportRequest, transfer: Transferable[] = []) =>
    worker.postMessage(msg, transfer);

  // A worker that failed (or finished) settles this at once; the render loops
  // below see it and stop instead of drawing both passes for nobody.
  let settled = false;
  // Encoding a frame takes the worker longer than drawing it takes us: sent
  // unasked, the frames of pass two waited in its message queue — all of them,
  // 14.7 MB each at 2560 px, the very pile the two passes exist to avoid.
  let encoded = 0;
  let wake: (() => void) | null = null;
  const caughtUp = async (sent: number): Promise<void> => {
    while (!settled && sent - encoded > FRAMES_IN_FLIGHT) {
      await new Promise<void>((resolve) => (wake = resolve));
    }
  };
  const bytes = new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    const done = (settle: () => void) => {
      settled = true;
      wake?.();
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
      settle();
    };
    function onAbort(): void {
      done(() => reject(new DOMException(t('export.cancelled'), 'AbortError')));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (e: MessageEvent<ExportResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        encoded = msg.done;
        wake?.();
        onProgress?.(msg.done, msg.total, 'encode');
      } else if (msg.type === 'done') {
        done(() => resolve(new Uint8Array(msg.bytes)));
      } else {
        done(() => reject(new Error(msg.message)));
      }
    };
    worker.onerror = () => done(() => reject(new Error('GIF export worker failed')));
  });
  // Handled at `return bytes`; a rejection before it is not «unhandled» in the Alt+L log.
  bytes.catch(() => {});

  try {
    send({
      type: 'open',
      fps: doc.frame_rate,
      totalPixels: total * size.width * size.height,
      total,
    });
    // Pass one: the colours. The progress line calls this the render, which is
    // what it is — the frames are drawn, read for their palette and dropped.
    for await (const frame of rasterizeFrames(doc, {
      ...raster,
      signal,
      onProgress: (done, count) => onProgress?.(done, count, 'render'),
    })) {
      if (settled) {
        break;
      }
      send({ type: 'sample', frame }, [frame.data]);
    }
    throwIfAborted(signal);
    send({ type: 'begin' });
    // Pass two: the bytes. Progress for this half comes back from the worker,
    // one message per frame it has actually encoded.
    let sent = 0;
    for await (const frame of rasterizeFrames(doc, { ...raster, signal })) {
      if (settled) {
        break;
      }
      send({ type: 'frame', frame }, [frame.data]);
      await caughtUp(++sent);
    }
    throwIfAborted(signal);
    send({ type: 'finish' });
  } catch (err) {
    worker.terminate();
    throw err;
  }

  return bytes;
}
