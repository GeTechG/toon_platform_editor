/**
 * Pure GIF encoding core: RGBA frames in, GIF bytes out. DOM-free so it
 * runs under bun test and inside the export worker. One shared 256-color
 * palette for the whole animation (no palette flicker), no dithering,
 * infinite loop.
 */

import { GIFEncoder, applyPalette, quantize } from 'gifenc';

export interface RgbaFrame {
  /** Opaque RGBA pixels, 4 bytes per pixel. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface EncodeGifOptions {
  fps: number;
  /** Called after each encoded frame. */
  onProgress?: (done: number, total: number) => void;
}

/** Palette quantization input is capped by sampling pixels evenly. */
const PALETTE_SAMPLE_MAX_PIXELS = 65536;

/**
 * Frame duration in ms, truncated like the reference (`toon.js:616`). GIF
 * itself stores hundredths of a second, so the encoder rounds this to
 * centiseconds — that last step is the format's own, and the only tempo drift.
 */
export function gifDelayMs(fps: number): number {
  return Math.max(1, Math.trunc(1000 / fps));
}

export function encodeGif(frames: RgbaFrame[], { fps, onProgress }: EncodeGifOptions): Uint8Array {
  const delayMs = gifDelayMs(fps);
  const palette = quantize(samplePixels(frames), 256);
  const gif = GIFEncoder();
  frames.forEach((frame, i) => {
    const index = applyPalette(frame.data, palette);
    gif.writeFrame(
      index,
      frame.width,
      frame.height,
      // Palette on the first frame only: it becomes the global color table.
      i === 0 ? { palette, delay: delayMs, repeat: 0 } : { delay: delayMs },
    );
    onProgress?.(i + 1, frames.length);
  });
  gif.finish();
  return gif.bytes();
}

/** Even-stride pixel sample across all frames for palette quantization. */
function samplePixels(frames: RgbaFrame[]): Uint8Array {
  const total = frames.reduce((n, f) => n + f.data.length / 4, 0);
  const stride = Math.max(1, Math.ceil(total / PALETTE_SAMPLE_MAX_PIXELS));
  const sample = new Uint32Array(frames.reduce((n, f) => n + Math.ceil(f.data.length / 4 / stride), 0));
  let si = 0;
  for (const f of frames) {
    const px = new Uint32Array(f.data.buffer, f.data.byteOffset, f.data.length / 4);
    for (let i = 0; i < px.length; i += stride) {
      sample[si++] = px[i];
    }
  }
  return new Uint8Array(sample.buffer);
}
