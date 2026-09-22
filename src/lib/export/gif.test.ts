import { describe, expect, test } from 'bun:test';
import { GifStream, encodeGif, gifDelayMs, type RgbaFrame } from './gif';

/** Solid-color opaque frame. */
function frame(w: number, h: number, [r, g, b]: [number, number, number]): RgbaFrame {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

/** Offsets of Graphic Control Extension blocks (0x21 0xF9 0x04), one per frame. */
function gceOffsets(bytes: Uint8Array): number[] {
  const found: number[] = [];
  for (let i = 0; i + 2 < bytes.length; i++) {
    if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) {
      found.push(i);
    }
  }
  return found;
}

/** Delay in centiseconds stored in the GCE at `offset`. */
function gceDelay(bytes: Uint8Array, offset: number): number {
  return bytes[offset + 4] | (bytes[offset + 5] << 8);
}

const ascii = (bytes: Uint8Array) => String.fromCharCode(...bytes);

describe('gifDelayMs', () => {
  test('the reference truncates milliseconds (toon.js:616)', () => {
    expect(gifDelayMs(12)).toBe(83);
    expect(gifDelayMs(24)).toBe(41);
    expect(gifDelayMs(5)).toBe(200);
  });
});

describe('encodeGif', () => {
  test('two frames → valid GIF89a with 2 frames and fps-derived delay', () => {
    const bytes = encodeGif([frame(4, 4, [255, 0, 0]), frame(4, 4, [0, 0, 255])], { fps: 12 });
    expect(bytes.length).toBeGreaterThan(0);
    expect(ascii(bytes.subarray(0, 6))).toBe('GIF89a');
    const gces = gceOffsets(bytes);
    expect(gces.length).toBe(2);
    // round(100 / 12) = 8 centiseconds — the only allowed tempo deviation.
    for (const at of gces) {
      expect(gceDelay(bytes, at)).toBe(8);
    }
  });

  test('single frame → valid GIF', () => {
    const bytes = encodeGif([frame(2, 2, [0, 0, 0])], { fps: 24 });
    expect(ascii(bytes.subarray(0, 6))).toBe('GIF89a');
    expect(gceOffsets(bytes).length).toBe(1);
  });

  test('delay follows fps', () => {
    const at24 = encodeGif([frame(2, 2, [0, 0, 0])], { fps: 24 });
    expect(gceDelay(at24, gceOffsets(at24)[0])).toBe(4); // round(100/24)
    const at20 = encodeGif([frame(2, 2, [0, 0, 0])], { fps: 20 });
    expect(gceDelay(at20, gceOffsets(at20)[0])).toBe(5);
  });

  test('loops forever (NETSCAPE2.0 loop count 0)', () => {
    const bytes = encodeGif([frame(2, 2, [0, 0, 0]), frame(2, 2, [255, 255, 255])], { fps: 12 });
    const at = ascii(bytes).indexOf('NETSCAPE2.0');
    expect(at).toBeGreaterThan(-1);
    // App extension payload: 0x03 0x01 <loop:uint16le> after the identifier.
    expect(bytes[at + 11]).toBe(0x03);
    expect(bytes[at + 12]).toBe(0x01);
    expect(bytes[at + 13] | (bytes[at + 14] << 8)).toBe(0);
  });

  test('reports per-frame progress', () => {
    const calls: [number, number][] = [];
    encodeGif([frame(2, 2, [0, 0, 0]), frame(2, 2, [255, 255, 255])], {
      fps: 12,
      onProgress: (done, total) => calls.push([done, total]),
    });
    expect(calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });
});

describe('GifStream', () => {
  // The whole animation used to be rasterized into an array before a byte was
  // encoded: at 2560×1440 a frame is 14.7 MB, so sixty of them is 880 MB held
  // at once — and PRODUCT.md measures every decision against a 2 GB Android.
  // The stream takes one frame at a time and is done with it before the next
  // arrives, so the peak is a frame, not an animation.
  test('one frame at a time gives the same bytes as the whole array', () => {
    const frames = [frame(4, 4, [255, 0, 0]), frame(4, 4, [0, 0, 255]), frame(4, 4, [0, 255, 0])];
    const whole = encodeGif(frames, { fps: 12 });

    const stream = new GifStream({ fps: 12, totalPixels: frames.length * 16 });
    for (const f of frames) stream.sample(f);
    stream.begin();
    for (const f of frames) stream.write(f);

    expect(stream.finish()).toEqual(whole);
  });

  test('a frame handed over is finished with before the next one', () => {
    // The caller transfers each buffer to the worker and reuses the canvas, so
    // a frame that is read again later is a frame that was never really given
    // up. Blanking it right after `write` proves the encoder is done with it.
    const frames = [frame(4, 4, [255, 0, 0]), frame(4, 4, [0, 0, 255])];
    const expected = encodeGif(
      [frame(4, 4, [255, 0, 0]), frame(4, 4, [0, 0, 255])],
      { fps: 12 },
    );

    const stream = new GifStream({ fps: 12, totalPixels: frames.length * 16 });
    for (const f of frames) stream.sample(f);
    stream.begin();
    for (const f of frames) {
      stream.write(f);
      f.data.fill(0);
    }

    expect(stream.finish()).toEqual(expected);
  });

  test('the palette is built before the first frame is written', () => {
    const stream = new GifStream({ fps: 12, totalPixels: 16 });
    stream.sample(frame(4, 4, [255, 0, 0]));
    expect(() => stream.write(frame(4, 4, [255, 0, 0]))).toThrow();
  });
});
