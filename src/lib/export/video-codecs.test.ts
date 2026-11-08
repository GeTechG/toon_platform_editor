import { describe, expect, test } from 'bun:test';
import { AUDIO_BITRATE, VIDEO_BITRATE, selectVideoTarget, videoEncodes } from './video-codecs';

const size = { width: 1280, height: 720 };

/** Probe stubs: a browser is the set of codec strings it will encode. */
const encodes =
  (...ok: string[]) =>
  (config: { codec: string }) =>
    Promise.resolve(ok.some((name) => config.codec.startsWith(name)));

const everything = () => Promise.resolve(true);
const nothing = () => Promise.resolve(false);

const select = (
  hasAudio: boolean,
  probeVideo: (c: { codec: string }) => Promise<boolean>,
  probeAudio: (c: { codec: string }) => Promise<boolean> = everything,
) => selectVideoTarget({ ...size, hasAudio, probeVideo, probeAudio });

describe('selectVideoTarget', () => {
  test('mp4 with H.264 and AAC where the browser encodes both', async () => {
    const target = await select(true, everything);
    expect(target).toMatchObject({ extension: 'mp4', videoCodec: 'avc', audioCodec: 'aac' });
  });

  test('a silent export names no audio codec at all', async () => {
    const target = await select(false, everything, nothing);
    expect(target).toMatchObject({ extension: 'mp4', videoCodec: 'avc' });
    expect(target?.audioCodec).toBeUndefined();
  });

  test('without an AAC encoder a sounded export falls to WebM', async () => {
    // Chrome on Linux: H.264 encodes, AAC does not.
    const target = await select(true, everything, encodes('opus'));
    expect(target).toMatchObject({ extension: 'webm', videoCodec: 'vp9', audioCodec: 'opus' });
  });

  test('without H.264 the export is WebM', async () => {
    const target = await select(true, encodes('vp09', 'vp8'));
    expect(target?.extension).toBe('webm');
  });

  test('WebM falls back to VP8 where VP9 does not encode', async () => {
    const target = await select(true, encodes('vp8'), encodes('opus'));
    expect(target).toMatchObject({ extension: 'webm', videoCodec: 'vp8' });
  });

  test('a browser that encodes nothing gets no target', async () => {
    expect(await select(true, nothing, nothing)).toBeNull();
  });

  test('bitrates are the reference ones', () => {
    expect(VIDEO_BITRATE).toBe(5_000_000);
    expect(AUDIO_BITRATE).toBe(128_000);
  });
});

/**
 * A WebCodecs `VideoEncoder` stand-in: it claims the config, then either
 * encodes a frame or reports an error the way Firefox does for H.264 on Linux.
 */
const fakeEncoder = (encodes: boolean, claims = true) =>
  class {
    private readonly init: { output: (chunk: unknown) => void; error: (err: Error) => void };
    constructor(init: { output: (chunk: unknown) => void; error: (err: Error) => void }) {
      this.init = init;
    }
    static isConfigSupported() {
      return Promise.resolve({ supported: claims });
    }
    configure() {}
    encode() {
      if (encodes) {
        this.init.output({});
      } else {
        queueMicrotask(() => this.init.error(new DOMException('The given encoding is not supported.', 'EncodingError')));
      }
    }
    flush() {
      return encodes ? Promise.resolve() : Promise.reject(new DOMException('Aborted due to error', 'AbortError'));
    }
    close() {}
  };

const frame = () => ({ close() {} });
const config = { codec: 'avc1.64001F', width: 640, height: 480, bitrate: VIDEO_BITRATE };

describe('videoEncodes', () => {
  test('a codec the encoder claims but fails on its first frame does not count', async () => {
    // Firefox on Linux: isConfigSupported says yes to H.264, encode says EncodingError.
    expect(await videoEncodes(fakeEncoder(false), frame, config)).toBe(false);
  });

  test('a codec that encodes a frame counts', async () => {
    expect(await videoEncodes(fakeEncoder(true), frame, config)).toBe(true);
  });

  test('a codec the encoder does not claim is not tried', async () => {
    expect(await videoEncodes(fakeEncoder(true, false), frame, config)).toBe(false);
  });

  test('no encoder at all counts as nothing', async () => {
    expect(await videoEncodes(undefined, frame, config)).toBe(false);
  });
});
