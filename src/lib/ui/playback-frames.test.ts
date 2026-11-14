import { describe, expect, it } from 'bun:test';
import { PlaybackFrames, playbackKeeps } from './playback-frames';

describe('frames of a playback', () => {
  const doc = {};
  const sheet = { width: 1280, height: 720 };

  it('hands a frame back as it was kept, for the same document and sheet', () => {
    const frames = new PlaybackFrames<string>();
    frames.keep(doc, sheet, 3, 'pixels of 3');
    expect(frames.get(doc, sheet, 3)).toBe('pixels of 3');
    expect(frames.get(doc, sheet, 4)).toBeUndefined();
  });

  it('drops every frame when the document is another', () => {
    const frames = new PlaybackFrames<string>();
    frames.keep(doc, sheet, 3, 'pixels of 3');
    expect(frames.get({}, sheet, 3)).toBeUndefined();
    expect(frames.get(doc, sheet, 3)).toBeUndefined();
  });

  it('drops every frame when the sheet bitmap is another size', () => {
    const frames = new PlaybackFrames<string>();
    frames.keep(doc, sheet, 3, 'pixels of 3');
    expect(frames.get(doc, { width: 1920, height: 1080 }, 3)).toBeUndefined();
  });

  it('lets go of everything when the playback stops', () => {
    const frames = new PlaybackFrames<string>();
    frames.keep(doc, sheet, 3, 'pixels of 3');
    frames.release();
    expect(frames.get(doc, sheet, 3)).toBeUndefined();
  });
});

describe('what a played frame is kept as', () => {
  const chrome = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';

  it('a bitmap where the browser makes them and does not count them as canvas memory', () => {
    expect(playbackKeeps(chrome, true)).toBe('bitmap');
  });
  it('pixels in Safari and every browser on an iPhone, which count bitmaps against a cap', () => {
    expect(playbackKeeps(safari, true)).toBe('pixels');
    expect(playbackKeeps(iphone, true)).toBe('pixels');
  });
  it('pixels where there is no bitmap to make', () => {
    expect(playbackKeeps(chrome, false)).toBe('pixels');
  });

  it('gives each frame back when it lets them go', () => {
    const freed: string[] = [];
    const frames = new PlaybackFrames<string>((pixels) => freed.push(pixels));
    const doc = {};
    const sheet = { width: 10, height: 10 };
    frames.keep(doc, sheet, 0, 'a');
    frames.keep(doc, sheet, 1, 'b');
    frames.get({}, sheet, 0);
    expect(freed.sort()).toEqual(['a', 'b']);
    frames.keep(doc, sheet, 0, 'c');
    frames.release();
    expect(freed).toContain('c');
  });
});

