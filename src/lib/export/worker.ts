/// <reference lib="webworker" />
/**
 * Web Worker wrapper over the pure GIF core: keeps LZW and palette
 * quantization off the main thread. Frames arrive as transferable RGBA
 * buffers; progress is reported per frame; the result buffer is
 * transferred back. Errors become messages, never worker crashes.
 */

import { encodeGif } from './gif';

declare const self: DedicatedWorkerGlobalScope;

export interface ExportRequest {
  frames: { data: ArrayBuffer; width: number; height: number }[];
  fps: number;
}

export type ExportResponse =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; bytes: ArrayBuffer }
  | { type: 'error'; message: string };

const post = (msg: ExportResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<ExportRequest>) => {
  try {
    const frames = e.data.frames.map((f) => ({
      data: new Uint8ClampedArray(f.data),
      width: f.width,
      height: f.height,
    }));
    const bytes = encodeGif(frames, {
      fps: e.data.fps,
      onProgress: (done, total) => post({ type: 'progress', done, total }),
    });
    // gifenc's bytes() is an exact-size copy, so its buffer is the GIF.
    post({ type: 'done', bytes: bytes.buffer as ArrayBuffer }, [bytes.buffer]);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
