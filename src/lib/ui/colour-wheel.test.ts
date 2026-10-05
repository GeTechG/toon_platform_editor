import { describe, expect, test } from 'bun:test';
import { compactLayout, pickStep } from './small-screen';
import { presetPanels } from './presets';
import { HARMONIES, discToSquare, harmonyHues, pointHue, pushHistory, squareToDisc } from './colour-wheel';

describe('the disc holds the whole square', () => {
  test('the corners of the square lie on the rim, the centre in the centre', () => {
    expect(squareToDisc(0, 0)).toEqual({ x: 0, y: 0 });
    const corner = squareToDisc(1, -1);
    expect(Math.hypot(corner.x, corner.y)).toBeCloseTo(1, 9);
    expect(squareToDisc(1, 0).x).toBeCloseTo(1, 9);
  });

  test('there and back is the same point', () => {
    for (const [x, y] of [[0.3, -0.7], [-1, 1], [0.99, 0.2], [-0.5, -0.5]]) {
      const disc = squareToDisc(x, y);
      const back = discToSquare(disc.x, disc.y);
      expect(back.x).toBeCloseTo(x, 6);
      expect(back.y).toBeCloseTo(y, 6);
    }
  });

  test('a point past the rim is read as the rim', () => {
    const out = discToSquare(2, 0);
    expect(out.x).toBeCloseTo(1, 6);
    expect(out.y).toBeCloseTo(0, 6);
  });
});

describe('the hue of a point', () => {
  test('red on the right, then against the clock: yellow-green up, cyan left, violet down', () => {
    // Screen offsets: y grows downward.
    expect(pointHue(1, 0)).toBe(0);
    expect(pointHue(0, -1)).toBe(90);
    expect(pointHue(-1, 0)).toBe(180);
    expect(pointHue(0, 1)).toBe(270);
  });
});

describe('harmonies', () => {
  test('each names the hues that go with the chosen one', () => {
    expect(harmonyHues(30, 'complementary')).toEqual([210]);
    expect(harmonyHues(30, 'split')).toEqual([180, 240]);
    expect(harmonyHues(10, 'analogous')).toEqual([40, 340]);
    expect(harmonyHues(300, 'triadic')).toEqual([60, 180]);
    expect(harmonyHues(0, 'tetradic')).toEqual([90, 180, 270]);
    expect(HARMONIES).toEqual(['complementary', 'split', 'analogous', 'triadic', 'tetradic']);
  });
});

describe('history', () => {
  test('the newest first, each colour once, ten at most', () => {
    expect(pushHistory(['#111111', '#222222'], '#222222')).toEqual(['#222222', '#111111']);
    expect(pushHistory(['#111111'], '#ABCDEF')).toEqual(['#abcdef', '#111111']);
    const full = Array.from({ length: 10 }, (_, i) => `#00000${i}`);
    const next = pushHistory(full, '#ffffff');
    expect(next).toHaveLength(10);
    expect(next[0]).toBe('#ffffff');
    expect(next).not.toContain('#000009');
  });
});

describe('a small screen', () => {
  test('the top bar\'s keys go to the tabs of the brush and the colours', () => {
    const cut = compactLayout(presetPanels('toonop'), 'phone', ['color', 'brush', 'timeline', 'sound', 'more']);
    expect(cut.tabs.find((tab) => tab.id === 'color')?.items).toEqual(['color-key']);
    expect(cut.tabs.find((tab) => tab.id === 'brush')?.items).toEqual(['brush-key']);
  });

  test('a phone standing up is a phone even with no right column to crowd the canvas', () => {
    // toonop without its right column left a 390 px screen 256 px of canvas —
    // over the floor, so the desktop's layout stayed on a phone.
    const rooms = { full: { w: 256, h: 600 }, tablet: { w: 256, h: 700 } };
    expect(pickStep('full', rooms, { w: 390, h: 844 })).toBe('phone');
    expect(pickStep('phone', rooms, { w: 390, h: 844 })).toBe('phone');
  });
});
