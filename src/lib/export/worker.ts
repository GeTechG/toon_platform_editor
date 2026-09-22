/// <reference lib="webworker" />
/**
 * Web Worker wrapper over the pure GIF core: keeps LZW and palette
 * quantization off the main thread. Frames arrive one at a time as
 * transferable RGBA buffers — the whole animation is never here, and never
 * was on the other side either — progress is reported per frame, and the
 * result buffer is transferred back. Errors become messages, never crashes.
 *
 * Two passes, because one palette for the whole animation has to be known
 * before the first frame is encoded: `sample` collects colours, `begin`
 * quantizes them, `frame` encodes.
 */

import { GifStream } from './gif';

declare const self: DedicatedWorkerGlobalScope;

export interface FrameBuffer {
  data: ArrayBuffer;
  width: number;
  height: number;
}

export type ExportRequest =
  | { type: 'open'; fps: number; totalPixels: number; total: number }
  | { type: 'sample'; frame: FrameBuffer }
  | { type: 'begin' }
  | { type: 'frame'; frame: FrameBuffer }
  | { type: 'finish' };

export type ExportResponse =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; bytes: ArrayBuffer }
  | { type: 'error'; message: string };

const post = (msg: ExportResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

let stream: GifStream | null = null;
let total = 0;
let written = 0;

/** The buffer as the encoder wants it; nothing is copied. */
const rgba = ({ data, width, height }: FrameBuffer) => ({
  data: new Uint8ClampedArray(data),
  width,
  height,
});

self.onmessage = (e: MessageEvent<ExportRequest>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'open':
        stream = new GifStream({ fps: msg.fps, totalPixels: msg.totalPixels });
        total = msg.total;
        written = 0;
        break;
      case 'sample':
        stream?.sample(rgba(msg.frame));
        break;
      case 'begin':
        stream?.begin();
        break;
      case 'frame':
        stream?.write(rgba(msg.frame));
        post({ type: 'progress', done: ++written, total });
        break;
      case 'finish': {
        if (!stream) {
          throw new Error('GIF export: no stream was opened');
        }
        // gifenc's bytes() is an exact-size copy, so its buffer is the GIF.
        const bytes = stream.finish();
        stream = null;
        post({ type: 'done', bytes: bytes.buffer as ArrayBuffer }, [bytes.buffer]);
        break;
      }
    }
  } catch (err) {
    stream = null;
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
