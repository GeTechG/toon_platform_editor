/**
 * Pure GIF encoding core: RGBA frames in, GIF bytes out. DOM-free so it
 * runs under bun test and inside the export worker. One shared 256-color
 * palette for the whole animation (no palette flicker), no dithering,
 * infinite loop.
 */

import { GIFEncoder, applyPalette, quantize, type Palette } from 'gifenc';

export interface RgbaFrame {
  /** Opaque RGBA pixels, 4 bytes per pixel. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface GifStreamOptions {
  fps: number;
  /** Every pixel the animation will hand over, so the stride is known up front. */
  totalPixels: number;
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

/**
 * A GIF built one frame at a time. The animation never exists as an array:
 * the caller rasterizes a frame, hands it over, and is free to reuse the
 * canvas underneath it — at 2560×1440 a frame is 14.7 MB, and holding sixty
 * of them was 880 MB on a phone PRODUCT.md promises to run on.
 *
 * The cost is that the document is drawn twice. One palette for the whole
 * animation means the colours have to be known before the first frame is
 * encoded, and the sample is taken from the same pixels the encoder will
 * later write — so pass one draws and samples, pass two draws and encodes.
 *
 * ponytail: two render passes over one memory pass. A single pass needs the
 * palette before the pixels exist — build it from the document's own colours,
 * if the second draw ever shows up in a measurement.
 */
export class GifStream {
  readonly #delayMs: number;
  readonly #stride: number;
  #sample: number[] = [];
  readonly #gif = GIFEncoder();
  #palette: Palette | null = null;
  #written = 0;

  constructor({ fps, totalPixels }: GifStreamOptions) {
    this.#delayMs = gifDelayMs(fps);
    this.#stride = sampleStride(totalPixels);
  }

  /** Pixels of the film already sampled past, frame after frame. */
  #seen = 0;
  /** Start of the current window of `stride` pixels, in the whole film. */
  #window = 0;
  /** The pixel picked inside that window, in the whole film. */
  #pick = 0;
  #seed = 0x9e3779b9;

  /**
   * Pass one: what this frame contributes to the shared palette. One pixel
   * per window of `stride`, at a random place in it, counted across the whole
   * film: a fixed step that restarted every frame landed on the same columns
   * of every frame — at 640 px and 182 frames the step was the row itself,
   * and the palette was built from the left edge alone.
   */
  sample(frame: RgbaFrame): void {
    const px = new Uint32Array(frame.data.buffer, frame.data.byteOffset, frame.data.length / 4);
    while (this.#pick < this.#seen + px.length) {
      this.#sample.push(px[this.#pick - this.#seen]);
      this.#window += this.#stride;
      this.#pick = this.#window + this.#jitter();
    }
    this.#seen += px.length;
  }

  /** A place inside a window; xorshift, so the same film gives the same GIF. */
  #jitter(): number {
    let x = this.#seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.#seed = x >>> 0;
    return this.#seed % this.#stride;
  }

  /** Closes the sample and quantizes it. Nothing may be written before this. */
  begin(): void {
    this.#palette = quantize(new Uint8Array(Uint32Array.from(this.#sample).buffer), 256);
    // The sample is the one thing here that grew with the animation; it is
    // spent now, and holding it would put the ceiling back.
    this.#sample = [];
  }

  /** Pass two: encodes one frame and keeps nothing of it. */
  write(frame: RgbaFrame): void {
    const palette = this.#palette;
    if (!palette) {
      throw new Error('GifStream: begin() must run before the first frame');
    }
    const index = applyPalette(frame.data, palette);
    this.#gif.writeFrame(
      index,
      frame.width,
      frame.height,
      // Palette on the first frame only: it becomes the global color table.
      this.#written === 0 ? { palette, delay: this.#delayMs, repeat: 0 } : { delay: this.#delayMs },
    );
    this.#written++;
  }

  finish(): Uint8Array {
    this.#gif.finish();
    return this.#gif.bytes();
  }
}

/** The whole animation in memory at once — the shape bun tests reach for. */
export function encodeGif(frames: RgbaFrame[], { fps, onProgress }: EncodeGifOptions): Uint8Array {
  const stream = new GifStream({
    fps,
    totalPixels: frames.reduce((n, f) => n + f.data.length / 4, 0),
  });
  for (const frame of frames) {
    stream.sample(frame);
  }
  stream.begin();
  frames.forEach((frame, i) => {
    stream.write(frame);
    onProgress?.(i + 1, frames.length);
  });
  return stream.finish();
}

/** Even-stride sampling keeps palette input bounded however long the film is. */
function sampleStride(totalPixels: number): number {
  return Math.max(1, Math.ceil(totalPixels / PALETTE_SAMPLE_MAX_PIXELS));
}
