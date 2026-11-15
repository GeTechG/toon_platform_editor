import { describe, expect, it } from 'bun:test';
import { aheadReady, firstUnready, playbackWindow, startNeed, windowFrames } from './playback-window';

describe('playbackWindow', () => {
  it('holds as many sheets of 1280×720 as the device memory step allows', () => {
    // 256 / 128 / 64 MB over 3 686 400 bytes a frame.
    expect(playbackWindow(8, 1280, 720)).toBe(72);
    expect(playbackWindow(4, 1280, 720)).toBe(36);
    expect(playbackWindow(undefined, 1280, 720)).toBe(18);
  });

  it('never holds fewer than two frames, however large the sheet', () => {
    expect(playbackWindow(undefined, 20000, 20000)).toBe(2);
  });
});

describe('windowFrames', () => {
  it('is the frames ahead of the one on screen, round the loop', () => {
    expect(windowFrames(10, 7, 5)).toEqual([7, 8, 9, 0, 1]);
  });

  it('is the whole film when it fits', () => {
    expect(windowFrames(4, 2, 10)).toEqual([2, 3, 0, 1]);
  });
});

describe('startNeed', () => {
  it('is the whole film when it fits the window', () => {
    expect(startNeed({ total: 40, window: 72, playRate: 6, rasterRate: 1 })).toBe(40);
  });

  it('is a second of the film when the device draws faster than it plays', () => {
    expect(startNeed({ total: 500, window: 72, playRate: 6, rasterRate: 20 })).toBe(6);
  });

  it('is what keeps the first lap ahead of the drawing on a slow device', () => {
    // Drawing 3 a second against 6 shown: half the film must be ready.
    expect(startNeed({ total: 100, window: 72, playRate: 6, rasterRate: 3 })).toBe(50);
  });

  it('is never more than the window', () => {
    expect(startNeed({ total: 500, window: 72, playRate: 6, rasterRate: 1 })).toBe(72);
  });

  it('is a second of the film before anything is measured', () => {
    expect(startNeed({ total: 500, window: 72, playRate: 12, rasterRate: undefined })).toBe(12);
  });
});

describe('aheadReady', () => {
  it('counts the frames ready in a row from the one on screen, round the loop', () => {
    const held = new Set([8, 9, 0, 2]);
    expect(aheadReady((i) => held.has(i), 10, 8)).toBe(3);
    expect(aheadReady((i) => held.has(i), 10, 1)).toBe(0);
  });

  it('stops at the whole film', () => {
    expect(aheadReady(() => true, 5, 3)).toBe(5);
  });
});

describe('firstUnready', () => {
  const held = new Set([0, 1, 2, 3, 5, 6, 7, 8, 9]);
  const has = (i: number) => held.has(i);

  it('is the first frame passed over that is not ready', () => {
    expect(firstUnready(has, 10, 2, 7, 0)).toBe(4);
  });

  it('is nothing when every frame passed over is ready', () => {
    expect(firstUnready(has, 10, 5, 8, 0)).toBeNull();
  });

  it('goes round the loop end', () => {
    expect(firstUnready((i) => i !== 0, 10, 8, 2, 1)).toBe(0);
  });

  it('counts a whole lap gone by, landing ahead of where it was', () => {
    // From 1 to 2 a lap later: frame 4 went by unready.
    expect(firstUnready(has, 10, 1, 2, 1)).toBe(4);
  });

  it('counts a whole lap gone by, landing behind where it was', () => {
    // From 8 to 1 is a wrap; past the end twice, a whole lap went by first.
    expect(firstUnready((i) => i !== 4, 10, 8, 1, 2)).toBe(4);
    expect(firstUnready((i) => i !== 4, 10, 8, 1, 1)).toBeNull();
  });

  it('counts a whole lap gone by, landing where it was', () => {
    expect(firstUnready(has, 10, 6, 6, 1)).toBe(4);
  });
});

