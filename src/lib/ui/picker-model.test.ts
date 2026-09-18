import { describe, expect, it } from 'bun:test';
import { barPointer, colorToPointer, nudgePointer, pointerToColor } from './picker-model';

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

describe('nudgePointer', () => {
  const mid = { x: 0.5, y: 0.5, bar: 0.5 };

  it('moves one unit of the axis, ten with Shift', () => {
    expect(nudgePointer('hsv', mid, 'ArrowRight', {}).x).toBeCloseTo(0.51, 6);
    expect(nudgePointer('hsv', mid, 'ArrowRight', { shift: true }).x).toBeCloseTo(0.6, 6);
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
