import { describe, expect, test } from 'bun:test';
import { assembleAnimatedWebp, downscaleSize, previewFrameBudget, type WebpStill } from './webp';

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));

/** A minimal, syntactically-valid WebP still: RIFF/WEBP wrapping one VP8L chunk. */
function fakeStill(width: number, height: number, payload: number[]): WebpStill {
  const chunk = [...payload];
  if (chunk.length % 2 === 1) chunk.push(0); // RIFF pads chunks to even length
  const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
  const body = [
    ...[...'WEBP'].map((c) => c.charCodeAt(0)),
    ...[...'VP8L'].map((c) => c.charCodeAt(0)),
    ...u32le(payload.length),
    ...chunk,
  ];
  const data = new Uint8Array([
    ...[...'RIFF'].map((c) => c.charCodeAt(0)),
    ...u32le(body.length),
    ...body,
  ]);
  return { data, width, height };
}

/** Offsets of every chunk with the given FourCC, scanning RIFF chunks from byte 12. */
function chunkOffsets(bytes: Uint8Array, fourcc: string): number[] {
  const found: number[] = [];
  let at = 12;
  while (at + 8 <= bytes.length) {
    const tag = ascii(bytes, at, at + 4);
    const size = bytes[at + 4] | (bytes[at + 5] << 8) | (bytes[at + 6] << 16) | (bytes[at + 7] << 24);
    if (tag === fourcc) found.push(at);
    at += 8 + size + (size % 2); // skip header + payload + RIFF even-padding
  }
  return found;
}

describe('assembleAnimatedWebp', () => {
  test('N still frames → RIFF/WEBP animation with N ANMF frames', () => {
    const frames = [
      fakeStill(4, 4, [1, 2, 3]),
      fakeStill(4, 4, [4, 5, 6]),
      fakeStill(4, 4, [7, 8, 9]),
    ];
    const out = assembleAnimatedWebp(frames, { fps: 12 });

    expect(ascii(out, 0, 4)).toBe('RIFF');
    expect(ascii(out, 8, 12)).toBe('WEBP');
    // Declared RIFF size covers everything after the 8-byte RIFF header.
    const riffSize = out[4] | (out[5] << 8) | (out[6] << 16) | (out[7] << 24);
    expect(riffSize).toBe(out.length - 8);
    // One ANMF per frame.
    expect(chunkOffsets(out, 'ANMF').length).toBe(3);
  });

  test('VP8X advertises animation and ANIM loops forever', () => {
    const out = assembleAnimatedWebp([fakeStill(4, 4, [1, 2, 3])], { fps: 12 });

    const vp8x = chunkOffsets(out, 'VP8X');
    expect(vp8x.length).toBe(1);
    // Flags byte (first byte of the VP8X payload): the Animation bit (0x02) is set.
    expect(out[vp8x[0] + 8] & 0x02).toBe(0x02);

    const anim = chunkOffsets(out, 'ANIM');
    expect(anim.length).toBe(1);
    // ANIM payload: 4-byte background color, then a uint16-LE loop count == 0.
    const loop = out[anim[0] + 8 + 4] | (out[anim[0] + 8 + 5] << 8);
    expect(loop).toBe(0);
  });
});

describe('previewFrameBudget', () => {
  test('caps at 50 frames', () => {
    expect(previewFrameBudget(12, { maxFrames: 50, maxSeconds: 10 })).toBe(50);
  });

  test('time cap can bind below the frame cap', () => {
    // ceil(2s * 24fps) = 48 < 50 → the time cap wins.
    expect(previewFrameBudget(24, { maxFrames: 50, maxSeconds: 2 })).toBe(48);
  });
});

describe('downscaleSize', () => {
  test('shrinks so the long side hits the cap, preserving aspect', () => {
    expect(downscaleSize(1200, 600, 384)).toEqual({ width: 384, height: 192 });
  });

  test('leaves an already-small image untouched', () => {
    expect(downscaleSize(100, 50, 384)).toEqual({ width: 100, height: 50 });
  });
});
