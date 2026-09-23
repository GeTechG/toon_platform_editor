import { describe, expect, it } from 'bun:test';
import { barPointer, colorToPointer, nudgePointer, pointerToColor, rgbChannelAt, surfaceToPointer } from './picker-model';

const MODELS = ['hsv', 'rgb', 'wheel'] as const;

describe('colorToPointer / pointerToColor', () => {
  it('puts pure red at the hue origin in the hsv model', () => {
    expect(colorToPointer('hsv', '#ff0000')).toEqual({ x: 1, y: 0, bar: 0 });
    expect(pointerToColor('hsv', { x: 1, y: 0, bar: 0 })).toBe('#ff0000');
  });

  it('maps the rgb model onto the three channels', () => {
    expect(colorToPointer('rgb', '#ff8000')).toEqual({ x: 0, y: 1 - 128 / 255, bar: 1 });
    expect(pointerToColor('rgb', { x: 0, y: 1 - 128 / 255, bar: 1 })).toBe('#ff8000');
  });

  it('puts the wheel centre at a grey of the bar value', () => {
    expect(pointerToColor('wheel', { x: 0.5, y: 0.5, bar: 1 })).toBe('#ffffff');
    expect(pointerToColor('wheel', { x: 0.5, y: 0.5, bar: 0 })).toBe('#000000');
  });

  it('round-trips every model within one per channel', () => {
    for (const model of MODELS) {
      for (const hex of ['#7fc9ff', '#ff0000', '#123456', '#b6ff00', '#808080']) {
        const back = pointerToColor(model, colorToPointer(model, hex));
        for (let i = 1; i < 7; i += 2) {
          const diff = Math.abs(parseInt(back.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16));
          expect(diff).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('surfaceToPointer', () => {
  it('reads the rgb surface as three columns, y the channel value', () => {
    const p = colorToPointer('rgb', '#112233');
    const top = surfaceToPointer('rgb', p, 0.5, 0);
    expect(pointerToColor('rgb', top)).toBe('#11ff33');
    expect(top.channel).toBe(1);
  });

  it('keeps the other channels when a column is dragged', () => {
    const p = colorToPointer('rgb', '#112233');
    expect(pointerToColor('rgb', surfaceToPointer('rgb', p, 0.1, 1))).toBe('#002233');
    expect(pointerToColor('rgb', surfaceToPointer('rgb', p, 0.9, 1))).toBe('#112200');
  });

  it('leaves the other models reading the surface as two axes', () => {
    const p = { x: 0.5, y: 0.5, bar: 0.5 };
    expect(surfaceToPointer('hsv', p, 0.3, 0.4)).toEqual({ x: 0.3, y: 0.4, bar: 0.5 });
    expect(surfaceToPointer('wheel', p, 0.3, 0.4)).toEqual({ x: 0.3, y: 0.4, bar: 0.5 });
  });

  it('snaps the gap between columns to the nearest one', () => {
    expect(rgbChannelAt(0)).toBe(0);
    expect(rgbChannelAt(0.33)).toBe(0);
    expect(rgbChannelAt(0.34)).toBe(1);
    expect(rgbChannelAt(1)).toBe(2);
  });
});

describe('nudgePointer', () => {
  const mid = { x: 0.5, y: 0.5, bar: 0.5 };

  it('moves one unit of the axis, five with Shift', () => {
    expect(nudgePointer('hsv', mid, 'ArrowRight', {}).x).toBeCloseTo(0.51, 6);
    expect(nudgePointer('hsv', mid, 'ArrowRight', { shift: true }).x).toBeCloseTo(0.55, 6);
    expect(nudgePointer('rgb', mid, 'ArrowLeft', {}).x).toBeCloseTo(0.5 - 1 / 255, 6);
  });

  it('reads ArrowUp as up the surface', () => {
    expect(nudgePointer('hsv', mid, 'ArrowUp', {}).y).toBeCloseTo(0.49, 6);
    expect(nudgePointer('hsv', mid, 'ArrowDown', {}).y).toBeCloseTo(0.51, 6);
  });

  it('drives the bar with Alt instead of the surface', () => {
    const alt = nudgePointer('hsv', mid, 'ArrowRight', { alt: true });
    expect(alt.x).toBe(0.5);
    expect(alt.bar).toBeCloseTo(0.5 + 1 / 360, 6);
  });

  it('drives the surface when Alt flips a bar target back', () => {
    const flipped = nudgePointer('hsv', mid, 'ArrowUp', { alt: true, target: 'bar' });
    expect(flipped.bar).toBe(0.5);
    expect(flipped.y).toBeCloseTo(0.49, 6);
  });

  it('moves the bar five units with Alt+Shift while the surface stays put', () => {
    const next = nudgePointer('hsv', mid, 'ArrowUp', { alt: true, shift: true, target: 'surface' });
    expect(next.bar).toBeCloseTo(0.5 + 5 / 360, 6);
    expect(next.y).toBe(0.5);
  });

  it('follows the last target without Alt', () => {
    const next = nudgePointer('hsv', mid, 'ArrowUp', { target: 'bar' });
    expect(next.bar).toBeCloseTo(0.5 + 1 / 360, 6);
    expect(next.y).toBe(0.5);
  });

  it('puts the rgb marker on the channel the key moves', () => {
    expect(nudgePointer('rgb', mid, 'ArrowUp', {}).channel).toBe(1);
    expect(nudgePointer('rgb', mid, 'ArrowRight', {}).channel).toBe(2);
    expect(nudgePointer('rgb', mid, 'ArrowUp', { target: 'bar' }).channel).toBe(0);
    expect(nudgePointer('hsv', mid, 'ArrowUp', {}).channel).toBeUndefined();
  });

  it('takes ten units on PageUp / PageDown', () => {
    expect(nudgePointer('hsv', mid, 'PageUp', {}).y).toBeCloseTo(0.4, 6);
    expect(nudgePointer('hsv', mid, 'PageDown', {}).y).toBeCloseTo(0.6, 6);
    expect(nudgePointer('hsv', mid, 'PageUp', { target: 'bar' }).bar).toBeCloseTo(0.5 + 10 / 360, 6);
  });

  it('runs to the ends of the axis on Home / End', () => {
    expect(nudgePointer('hsv', mid, 'Home', {})).toEqual({ ...mid, x: 0 });
    expect(nudgePointer('hsv', mid, 'End', {})).toEqual({ ...mid, x: 1 });
    expect(nudgePointer('hsv', mid, 'End', { target: 'bar' })).toEqual({ ...mid, bar: 1 });
  });

  it('clamps at the edges and ignores other keys', () => {
    const edge = { x: 1, y: 0, bar: 0 };
    expect(nudgePointer('hsv', edge, 'ArrowRight', { shift: true })).toEqual(edge);
    expect(nudgePointer('hsv', edge, 'ArrowUp', {})).toEqual(edge);
    expect(nudgePointer('hsv', mid, 'Enter', {})).toEqual(mid);
  });
});

describe('barPointer', () => {
  it('keeps the hue strip fully saturated whatever the surface holds', () => {
    const dark = { x: 0, y: 1, bar: 0.5 };
    expect(barPointer('hsv', dark)).toEqual({ x: 1, y: 0, bar: 0.5 });
  });

  it('leaves the other models reading their own surface', () => {
    const p = { x: 0.2, y: 0.8, bar: 0.4 };
    expect(barPointer('rgb', p)).toEqual(p);
    expect(barPointer('wheel', p)).toEqual(p);
  });
});
