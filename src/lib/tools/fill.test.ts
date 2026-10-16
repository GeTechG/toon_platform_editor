import { describe, expect, it } from 'bun:test';
import { fillPlace, fillRegion, keyhole, simplifyRing, traceOutline, traceRings } from './fill';
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
    // The soft rim on the far side of a line is not reached either.
    const rimmed = box(1);
    rimmed[7 * 20 + 1] = 30;
    expect(at(fillRegion(rimmed, 20, 20, 7, 7, 0, 2)!, 1, 7)).toBe(0);
  });

  /** A 30×30 sheet: a ring 2..27 and inside it a square ring `lo`..`hi`. */
  const nested = (lo: number, hi: number) => sheet(30, 30, (x, y) => {
    const ring = (a: number, b: number) => x >= a && x <= b && y >= a && y <= b && (x === a || x === b || y === a || y === b);
    return ring(2, 27) || ring(lo, hi);
  });

  it('leaves what a line encloses inside the area out of it', () => {
    const mask = fillRegion(nested(8, 20), 30, 30, 4, 4, 0, 0)!;
    expect(mask[4 * 30 + 4]).toBe(1);
    expect(mask[14 * 30 + 14]).toBe(0);
  });

  it('takes a speck the lines enclose with it', () => {
    const mask = fillRegion(nested(8, 10), 30, 30, 4, 4, 0, 0)!;
    expect(mask[9 * 30 + 9]).toBe(1);
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

describe('fillPlace', () => {
  const tools: ToolDescriptor[] = [
    { kind: 'pencil', geometry: 'line', width: 2, color: '#000000' },
    { kind: 'eraser', geometry: 'line', width: 2 },
    { kind: 'contour', geometry: 'line', color: '#ff0000' },
    { kind: 'pencil', geometry: 'smooth', width: 6, color: '#000000' },
  ];
  const line = (...points: number[]) => ({ points, tool_id: 0 });
  const erase = (...points: number[]) => ({ points, tool_id: 1 });
  const fill = (...points: number[]) => ({ points, tool_id: 2 });
  // The area: the block 5..9 × 5..9 of a 20×20 sheet; its outline runs 5..10.
  const area = new Uint8Array(400);
  for (let y = 5; y < 10; y++) for (let x = 5; x < 10; x++) area[y * 20 + x] = 1;
  const place = (strokes: { points: number[]; tool_id: number }[]) => fillPlace(area, 20, 20, strokes, tools, 1);
  const slot = (strokes: { points: number[]; tool_id: number }[]) => place(strokes).slot;

  it('goes under the lowest line touching the area', () => {
    expect(slot([line(0, 0, 0, 19), line(4, 0, 4, 19), line(10, 0, 10, 19)])).toBe(1);
  });

  it('counts a line inside the area', () => {
    expect(slot([line(0, 0, 0, 19), line(7, 6, 8, 8), line(4, 0, 4, 19)])).toBe(1);
  });

  it('goes to the bottom when no line touches it', () => {
    expect(slot([line(0, 0, 0, 19), line(19, 0, 19, 19)])).toBe(0);
  });

  it('keeps under its lines whatever lies over them', () => {
    // An eraser or a fill over the border line would cover or cut the new
    // fill; the line covering it would be worse (owner, 2026-10-16).
    expect(slot([line(4, 0, 4, 19), erase(6, 6, 8, 8)])).toBe(0);
    expect(slot([line(4, 0, 4, 19), fill(0, 0, 19, 0, 19, 19, 0, 19)])).toBe(0);
  });

  it('with no line, stays above an eraser or a fill it meets', () => {
    expect(slot([erase(6, 6, 8, 8), line(19, 0, 19, 19)])).toBe(1);
    expect(slot([fill(0, 0, 19, 0, 19, 19, 0, 19)])).toBe(1);
  });

  it('takes no old fill for a border, and goes over one under its lines', () => {
    expect(slot([fill(2, 2, 14, 2, 14, 14, 2, 14), line(4, 0, 4, 19), line(10, 0, 10, 19)])).toBe(1);
  });

  it('replaces an old fill of the same area, wherever it lay', () => {
    expect(place([fill(5, 5, 10, 5, 10, 10, 5, 10), line(4, 0, 4, 19)])).toEqual({ slot: 0, replaced: [0] });
    expect(place([line(4, 0, 4, 19), fill(5, 5, 10, 5, 10, 10, 5, 10)])).toEqual({ slot: 0, replaced: [1] });
  });

  it('replaces an old fill traced a pixel or two wider, and keeps one that reaches beyond', () => {
    expect(place([fill(4, 3, 11, 4, 11, 11, 4, 11)]).replaced).toEqual([0]);
    expect(place([fill(5, 5, 15, 5, 15, 10, 5, 10)]).replaced).toEqual([]);
  });

  it('reads a curve where it is drawn, not along the points that shape it', () => {
    // A quick stroke: three points far from the area, the curve they shape
    // passing three pixels over it.
    const curve = { points: [-30, 30, 7, -26, 44, 30], tool_id: 3 };
    expect(slot([line(19, 0, 19, 19), curve])).toBe(1);
  });
});

describe('traceRings', () => {
  it('walks the outline clockwise and a hole the other way', () => {
    const m = new Uint8Array(100);
    for (let y = 1; y <= 6; y++) for (let x = 1; x <= 6; x++) m[y * 10 + x] = 1;
    m[3 * 10 + 3] = 0;
    expect(traceRings(m, 10, 10)).toEqual([[1, 1, 7, 1, 7, 7, 1, 7], [3, 3, 3, 4, 4, 4, 4, 3]]);
  });
});

describe('keyhole', () => {
  it('joins the holes to the outline there and back from its first corner', () => {
    expect(keyhole([[0, 0, 9, 0, 9, 9], [3, 3, 3, 4, 4, 4], [6, 6, 6, 7, 7, 7]]))
      .toEqual([0, 0, 9, 0, 9, 9, 0, 0, 3, 3, 3, 4, 4, 4, 3, 3, 0, 0, 6, 6, 6, 7, 7, 7, 6, 6]);
  });

  it('leaves a lone outline as it is', () => {
    expect(keyhole([[0, 0, 9, 0, 9, 9]])).toEqual([0, 0, 9, 0, 9, 9]);
  });
});

describe('simplifyRing', () => {
  it('keeps every corner of a square, the one the ring closes on too', () => {
    expect(simplifyRing([0, 0, 10, 0, 10, 10, 0, 10])).toHaveLength(8);
  });

  it('straightens a staircase of pixel edges to its few true turns', () => {
    // A 45° edge walked pixel by pixel, closed into a triangle.
    const ring: number[] = [];
    for (let i = 0; i < 40; i++) ring.push(i, i, i + 1, i);
    ring.push(40, 40, 0, 40);
    expect(simplifyRing(ring).length / 2).toBeLessThanOrEqual(4);
  });
});
