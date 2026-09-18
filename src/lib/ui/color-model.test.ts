import { describe, expect, it } from 'bun:test';
import { hexToRgb, hsvToRgb, parseHex, rgbToHex, rgbToHsv, wheelToHsv } from './color-model';

describe('parseHex', () => {
  it('takes 6 digits with and without the hash', () => {
    expect(parseHex('#7fc9ff')).toBe('#7fc9ff');
    expect(parseHex('7FC9FF')).toBe('#7fc9ff');
  });

  it('expands 3 digits', () => {
    expect(parseHex('f00')).toBe('#ff0000');
    expect(parseHex('#0A8')).toBe('#00aa88');
  });

  it('rejects anything else', () => {
    expect(parseHex('')).toBeNull();
    expect(parseHex('#ff00')).toBeNull();
    expect(parseHex('zzzzzz')).toBeNull();
    expect(parseHex('#1234567')).toBeNull();
  });
});

describe('hexToRgb / rgbToHex', () => {
  it('round-trips', () => {
    expect(hexToRgb('#7fc9ff')).toEqual({ r: 127, g: 201, b: 255 });
    expect(rgbToHex({ r: 127, g: 201, b: 255 })).toBe('#7fc9ff');
  });

  it('clamps and rounds channels out of range', () => {
    expect(rgbToHex({ r: -5, g: 255.6, b: 300 })).toBe('#00ffff');
  });
});

describe('rgbToHsv / hsvToRgb', () => {
  it('reads the primaries', () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, v: 100 });
    expect(rgbToHsv({ r: 0, g: 255, b: 0 })).toEqual({ h: 120, s: 100, v: 100 });
    expect(rgbToHsv({ r: 0, g: 0, b: 255 })).toEqual({ h: 240, s: 100, v: 100 });
  });

  it('gives black and white a zero hue and saturation', () => {
    expect(rgbToHsv({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, v: 0 });
    expect(rgbToHsv({ r: 255, g: 255, b: 255 })).toEqual({ h: 0, s: 0, v: 100 });
  });

  it('comes back within one per channel', () => {
    for (const hex of ['#7fc9ff', '#000000', '#ffffff', '#ff0000', '#123456', '#b6ff00', '#8a8a8a']) {
      const rgb = hexToRgb(hex);
      const back = hsvToRgb(rgbToHsv(rgb));
      expect(Math.abs(back.r - rgb.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.g - rgb.g)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.b - rgb.b)).toBeLessThanOrEqual(1);
    }
  });

  it('wraps a hue of 360 back to 0', () => {
    expect(hsvToRgb({ h: 360, s: 100, v: 100 })).toEqual({ r: 255, g: 0, b: 0 });
  });
});

describe('wheelToHsv', () => {
  it('reads hue from the angle and saturation from the radius', () => {
    // Offsets are fractions of the wheel radius. Right of centre is hue 0.
    expect(wheelToHsv(0.5, 0)).toEqual({ h: 0, s: 50 });
    // Straight down (canvas y grows downward) is a quarter turn.
    expect(wheelToHsv(0, 1)).toEqual({ h: 90, s: 100 });
  });

  it('clamps outside the wheel to the rim', () => {
    expect(wheelToHsv(3, 0)).toEqual({ h: 0, s: 100 });
  });
});
