import { describe, expect, it } from 'bun:test';
import { PlaybackFrames } from './playback-frames';

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
