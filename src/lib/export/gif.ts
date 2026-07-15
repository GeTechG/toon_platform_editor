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

export function encodeGif(frames: RgbaFrame[], { fps, onProgress }: EncodeGifOptions): Uint8Array {
  // ponytail: whole centiseconds — GIF stores delay in 1/100 s, the tempo
  // drift (~4% at 12 fps) is inherent to the format.
  const delayMs = Math.max(1, Math.round(100 / fps)) * 10;
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
