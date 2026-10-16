import { describe, expect, it } from 'bun:test';
import { fillRegion, fillSlot, traceOutline } from './fill';
import type { ToolDescriptor } from '../format/types';

/** A sheet of `w`×`h` alpha, with the given pixels opaque. */
function sheet(w: number, h: number, ink: (x: number, y: number) => boolean): Uint8Array {
  const alpha = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink(x, y)) alpha[y * w + x] = 255;
  return alpha;
}

/** A square outline from (2,2) to (12,12), `thick` pixels wide, with an optional gap in its top side. */
function box(thick = 1, gap = 0) {
  return sheet(20, 20, (x, y) => {
    const on = x >= 2 && x <= 12 && y >= 2 && y <= 12
      && (x < 2 + thick || x > 12 - thick || y < 2 + thick || y > 12 - thick);
    const inGap = y < 2 + thick && x >= 7 && x < 7 + gap;
    return on && !inGap;
  });
}

const at = (mask: Uint8Array, x: number, y: number) => mask[y * 20 + x];

describe('fillRegion', () => {
  it('covers the whole sheet when the layer is empty', () => {
    const mask = fillRegion(new Uint8Array(20 * 20), 20, 20, 5, 5, 0, 0)!;
    expect(mask.every((v) => v === 1)).toBe(true);
  });

  it('stays inside a closed outline', () => {
    const mask = fillRegion(box(), 20, 20, 7, 7, 0, 0)!;
    expect(at(mask, 7, 7)).toBe(1);
    expect(at(mask, 3, 3)).toBe(1);
    expect(at(mask, 0, 0)).toBe(0);
    expect(at(mask, 15, 15)).toBe(0);
  });

  it('refuses a press on the line itself', () => {
    expect(fillRegion(box(), 20, 20, 2, 7, 0, 0)).toBeNull();
  });

  it('leaks through a gap wider than the tolerance', () => {
    const mask = fillRegion(box(1, 2), 20, 20, 7, 7, 0, 0)!;
    expect(at(mask, 0, 0)).toBe(1);
  });

  it('holds at a gap no wider than the tolerance, and still reaches the corners', () => {
    const mask = fillRegion(box(1, 2), 20, 20, 7, 7, 4, 0)!;
    expect(at(mask, 0, 0)).toBe(0);
    expect(at(mask, 15, 15)).toBe(0);
    expect(at(mask, 3, 3)).toBe(1);
    expect(at(mask, 11, 11)).toBe(1);
  });

  it('grows under the line by its inked pixels, never past a thin line', () => {
    const thick = fillRegion(box(3), 20, 20, 7, 7, 0, 2)!;
    expect(at(thick, 3, 7)).toBe(1);
    expect(at(thick, 2, 7)).toBe(0);
    const thin = fillRegion(box(1), 20, 20, 7, 7, 0, 2)!;
    expect(at(thin, 2, 7)).toBe(1);
    expect(at(thin, 1, 7)).toBe(0);
  });

  it('takes an island inside the area with it', () => {
    const ring = box(1);
    ring[7 * 20 + 7] = 255;
    const mask = fillRegion(ring, 20, 20, 4, 4, 0, 0)!;
    expect(at(mask, 7, 7)).toBe(1);
  });
});

describe('traceOutline', () => {
  /** A 10×10 mask with the given pixels in it. */
  const mask = (...pixels: [number, number][]) => {
    const m = new Uint8Array(100);
    for (const [x, y] of pixels) m[y * 10 + x] = 1;
    return m;
  };
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    const out: [number, number][] = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
    return out;
  };

  it('draws a block as its four corners, on the pixel edges', () => {
    expect(traceOutline(mask(...rect(3, 2, 5, 4)), 10, 10)).toEqual([3, 2, 6, 2, 6, 5, 3, 5]);
  });

  it('walks round a notch', () => {
    const l = rect(0, 0, 2, 2).filter(([x, y]) => !(x === 2 && y === 0));
    expect(traceOutline(mask(...l), 10, 10)).toEqual([0, 0, 2, 0, 2, 1, 3, 1, 3, 3, 0, 3]);
  });

  it('keeps pixels joined only by a corner', () => {
    expect(traceOutline(mask([1, 1], [2, 2]), 10, 10)).toEqual([1, 1, 2, 1, 2, 2, 3, 2, 3, 3, 2, 3, 2, 2, 1, 2]);
  });
});

describe('fillSlot', () => {
  const tools: ToolDescriptor[] = [
    { kind: 'pencil', geometry: 'line', width: 2, color: '#000000' },
    { kind: 'eraser', geometry: 'line', width: 2 },
  ];
  const line = (...points: number[]) => ({ points, tool_id: 0 });
  const erase = (...points: number[]) => ({ points, tool_id: 1 });
  // The area: the block 5..9 × 5..9 of a 20×20 sheet.
  const area = new Uint8Array(400);
  for (let y = 5; y < 10; y++) for (let x = 5; x < 10; x++) area[y * 20 + x] = 1;
  const slot = (strokes: { points: number[]; tool_id: number }[]) => fillSlot(area, 20, 20, strokes, tools, 1);

  it('goes under the lowest line touching the area', () => {
    expect(slot([line(0, 0, 0, 19), line(4, 0, 4, 19), line(10, 0, 10, 19)])).toBe(1);
  });

  it('counts a line inside the area', () => {
    expect(slot([line(0, 0, 0, 19), line(7, 6, 8, 8), line(4, 0, 4, 19)])).toBe(1);
  });

  it('goes to the bottom when no line touches it', () => {
    expect(slot([line(0, 0, 0, 19), line(19, 0, 19, 19)])).toBe(0);
  });

  it('stays above an eraser that crossed the area, which would cut it', () => {
    expect(slot([line(4, 0, 4, 19), erase(6, 6, 8, 8), line(10, 0, 10, 19)])).toBe(2);
    expect(slot([line(4, 0, 4, 19), erase(15, 15, 18, 18)])).toBe(0);
  });
});
