import { describe, expect, test } from 'bun:test';
import {
  VIDEO_CONTAINERS,
  exportFrameCount,
  fillLooped,
  frameDeadlines,
  supportedVideoFormats,
} from './video';

describe('supportedVideoFormats', () => {
  /** Chrome on Linux: mp4 records, but there is no AAC encoder to record with. */
  const noAac = (type: string) => !type.includes('mp4a');
  /** Firefox: WebM only, and only VP8. */
  const firefox = (type: string) => type.startsWith('video/webm') && type.includes('vp8');

  test('mp4 leads when the browser can record it', () => {
    const formats = supportedVideoFormats(true, () => true);
    expect(formats.map((f) => f.extension)).toEqual(['mp4', 'webm']);
  });

  test('without mp4 only WebM is offered', () => {
    const formats = supportedVideoFormats(true, (type) => !type.startsWith('video/mp4'));
    expect(formats.map((f) => f.extension)).toEqual(['webm']);
  });

  test('a browser that records neither offers nothing', () => {
    expect(supportedVideoFormats(true, () => false)).toEqual([]);
  });

  test('with a track, mp4 carries H.264 and AAC', () => {
    expect(supportedVideoFormats(true, () => true)[0].mimeType).toBe(
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    );
  });

  test('a silent export asks for mp4 without an audio codec', () => {
    const formats = supportedVideoFormats(false, noAac);
    expect(formats.map((f) => f.extension)).toEqual(['mp4', 'webm']);
    expect(formats[0].mimeType).toBe('video/mp4;codecs=avc1.42E01E');
  });

  test('with a track, mp4 without an AAC encoder is not offered at all', () => {
    // An mp4 with Opus inside is an mp4 a phone will not play — WebM is honest.
    expect(supportedVideoFormats(true, noAac).map((f) => f.extension)).toEqual(['webm']);
  });

  test('WebM falls back to VP8 where VP9 cannot be recorded', () => {
    const formats = supportedVideoFormats(true, firefox);
    expect(formats.map((f) => f.mimeType)).toEqual(['video/webm;codecs=vp8,opus']);
  });

  test('WebM prefers VP9 when both codecs record', () => {
    const webm = supportedVideoFormats(true, () => true).find((f) => f.extension === 'webm');
    expect(webm?.mimeType).toBe('video/webm;codecs=vp9,opus');
  });

  test('a silent WebM names no audio codec either', () => {
    // Firefox hangs on a recorder told to write Opus when the stream carries
    // no audio track at all — the export never finishes.
    const formats = supportedVideoFormats(false, (type) => !type.startsWith('video/mp4'));
    expect(formats.map((f) => f.mimeType)).toEqual(['video/webm;codecs=vp9']);
  });

  test('a silent WebM falls back to VP8 as well', () => {
    const firefoxSilent = (type: string) => type === 'video/webm;codecs=vp8';
    expect(supportedVideoFormats(false, firefoxSilent).map((f) => f.mimeType)).toEqual([
      'video/webm;codecs=vp8',
    ]);
  });

  test('every container offers a codec string for sound and a label', () => {
    for (const container of VIDEO_CONTAINERS) {
      expect(container.withSound.length).toBeGreaterThan(0);
      for (const type of container.withSound) {
        expect(type).toMatch(/^video\/(mp4|webm);codecs=/);
      }
      expect(container.label.length).toBeGreaterThan(0);
    }
  });
});

describe('frameDeadlines', () => {
  test('frames land on the document rate, first one at zero', () => {
    expect(Array.from(frameDeadlines(4, 12))).toEqual([0, 1000 / 12, 2000 / 12, 3000 / 12]);
  });

  test('the whole run lasts count / fps seconds', () => {
    const deadlines = frameDeadlines(24, 24);
    expect(deadlines.length).toBe(24);
    expect(deadlines[23] + 1000 / 24).toBeCloseTo(1000, 5);
  });

  test('a single frame still gets a deadline', () => {
    expect(Array.from(frameDeadlines(1, 12))).toEqual([0]);
  });
});

describe('exportFrameCount', () => {
  test('without a track the video is the animation, once', () => {
    expect(exportFrameCount(5, 12, undefined)).toBe(5);
  });

  test('a tied track sets the length: the animation loops to fill it', () => {
    // 5 frames at 12 fps is 0.42 s; a 3-minute track is 2160 frames of it.
    expect(exportFrameCount(5, 12, 180)).toBe(2160);
  });

  test('a track shorter than the animation never cuts the animation short', () => {
    expect(exportFrameCount(48, 12, 1)).toBe(48);
  });

  test('a track the same length as the animation changes nothing', () => {
    expect(exportFrameCount(24, 12, 2)).toBe(24);
  });

  test('an untied track leaves the length alone', () => {
    expect(exportFrameCount(5, 12, undefined)).toBe(5);
  });
});

describe('fillLooped', () => {
  test('a track shorter than the video repeats instead of falling silent', () => {
    const out = new Float32Array(5);
    fillLooped(Float32Array.from([1, 2]), out);
    expect(Array.from(out)).toEqual([1, 2, 1, 2, 1]);
  });

  test('a track longer than the video is cut, not squeezed', () => {
    const out = new Float32Array(2);
    fillLooped(Float32Array.from([1, 2, 3, 4]), out);
    expect(Array.from(out)).toEqual([1, 2]);
  });

  test('an empty track leaves silence', () => {
    const out = new Float32Array(3);
    fillLooped(new Float32Array(0), out);
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });
});
