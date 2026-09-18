import { describe, expect, test } from 'bun:test';
import { VIDEO_FORMATS, frameDeadlines, supportedVideoFormats } from './video';

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
