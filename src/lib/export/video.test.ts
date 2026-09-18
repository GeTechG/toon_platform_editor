import { describe, expect, test } from 'bun:test';
import { VIDEO_FORMATS, exportFrameCount, frameDeadlines, supportedVideoFormats } from './video';

describe('supportedVideoFormats', () => {
  test('mp4 leads when the browser can record it', () => {
    const formats = supportedVideoFormats(() => true);
    expect(formats.map((f) => f.extension)).toEqual(['mp4', 'webm']);
  });

  test('without mp4 only WebM is offered', () => {
    const formats = supportedVideoFormats((type) => !type.startsWith('video/mp4'));
    expect(formats.map((f) => f.extension)).toEqual(['webm']);
  });

  test('a browser that records neither offers nothing', () => {
    expect(supportedVideoFormats(() => false)).toEqual([]);
  });

  test('every advertised format names a container and a codec pair', () => {
    for (const format of VIDEO_FORMATS) {
      expect(format.mimeType).toMatch(/^video\/(mp4|webm);codecs=/);
      expect(format.label.length).toBeGreaterThan(0);
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
