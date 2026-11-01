import { describe, expect, it } from 'bun:test';
import { colourDistance, fillRegion, growRim, keyhole, lowestSeenSlot, oldFillsIn, recolouredFill, simplifyRing, smoothRing, traceOutline, traceRings } from './fill';
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

/** A `w`×`h` picture on empty paper: what `paint` names is opaque, the rest is not drawn. */
function picture(w: number, h: number, paint: (x: number, y: number) => readonly number[] | null): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = paint(x, y);
      if (c) rgba.set(c.length === 4 ? c : [...c, 255], (y * w + x) * 4);
    }
  }
  return rgba;
}
const WHITE = [255, 255, 255] as const;
const BLACK = [0, 0, 0] as const;
const RED = [255, 0, 0] as const;

/** Where a press at (x, y) pours in a 20×20 picture: tolerance 25 of 255. */
const pour20 = (rgba: Uint8ClampedArray, x: number, y: number, tolerance = 25, gap = 0) =>
  fillRegion(colourDistance(rgba, 20, 20, x, y, WHITE), 20, 20, x, y, tolerance, gap);

describe('fillRegion by the colour seen', () => {
  const ring = (x: number, y: number) => box()[y * 20 + x] ? BLACK : null;

  it('pours over the whole empty sheet', () => {
    expect(pour20(picture(20, 20, () => null), 5, 5).every((v) => v === 1)).toBe(true);
  });

  it('stays inside a closed outline', () => {
    const mask = pour20(picture(20, 20, ring), 7, 7);
    expect(at(mask, 7, 7)).toBe(1);
    expect(at(mask, 3, 3)).toBe(1);
    expect(at(mask, 2, 7)).toBe(0);
    expect(at(mask, 0, 0)).toBe(0);
  });

  it('pressed on the line, takes the whole line and nothing else', () => {
    const mask = pour20(picture(20, 20, ring), 2, 7);
    expect(at(mask, 2, 7)).toBe(1);
    expect(at(mask, 12, 12)).toBe(1);
    expect(at(mask, 7, 7)).toBe(0);
    expect(at(mask, 0, 0)).toBe(0);
  });

  it('pressed on a painted blob, takes it up to the next colour', () => {
    const blob = (x: number) => (x === 10 ? BLACK : RED);
    const mask = pour20(picture(20, 20, blob), 3, 3);
    expect(at(mask, 9, 3)).toBe(1);
    expect(at(mask, 10, 3)).toBe(0);
    expect(at(mask, 11, 3)).toBe(0);
  });

  it('takes an old fill for a border when pressed beside it', () => {
    const half = (x: number) => (x < 10 ? RED : null);
    const mask = pour20(picture(20, 20, half), 15, 5);
    expect(at(mask, 10, 5)).toBe(1);
    expect(at(mask, 9, 5)).toBe(0);
  });

  it('sees white ink on the paper as paper', () => {
    const mask = pour20(picture(20, 20, (x) => (x === 10 ? WHITE : null)), 3, 3);
    expect(at(mask, 15, 3)).toBe(1);
  });

  it('crosses what is within the tolerance and stops at what is not', () => {
    const shades = (x: number) => (x < 10 ? [200, 200, 200] : [220, 220, 220]);
    expect(at(pour20(picture(20, 20, shades), 3, 3, 25), 15, 3)).toBe(1);
    expect(at(pour20(picture(20, 20, shades), 3, 3, 10), 15, 3)).toBe(0);
  });

  it('counts half-covered ink as the mix the eye sees', () => {
    // 8% black on the paper is within the tolerance, 50% is not.
    const faint = (x: number) => (x === 10 ? [0, 0, 0, 20] : null);
    const half = (x: number) => (x === 10 ? [0, 0, 0, 128] : null);
    expect(at(pour20(picture(20, 20, faint), 3, 3), 15, 3)).toBe(1);
    expect(at(pour20(picture(20, 20, half), 3, 3), 15, 3)).toBe(0);
  });

  it('leaves what a line encloses as a hole, and takes a speck with it', () => {
    const nested = (lo: number, hi: number) => picture(30, 30, (x, y) => {
      const r = (a: number, b: number) => x >= a && x <= b && y >= a && y <= b && (x === a || x === b || y === a || y === b);
      return r(2, 27) || r(lo, hi) ? BLACK : null;
    });
    const pour = (rgba: Uint8ClampedArray) => fillRegion(colourDistance(rgba, 30, 30, 4, 4, WHITE), 30, 30, 4, 4, 25, 0);
    expect(pour(nested(8, 20))[14 * 30 + 14]).toBe(0);
    expect(pour(nested(8, 10))[9 * 30 + 9]).toBe(1);
  });
});

describe('fillRegion on a diagonal', () => {
  it('follows a thin smooth line whose core is joined only by corners', () => {
    // A green line at 45° on the paper: its pure pixels touch by their corners,
    // the pixels either side are half green, half paper.
    const line = picture(20, 20, (x, y) => {
      const off = Math.abs(x - y);
      return off === 0 ? [0, 255, 0] : off === 1 ? [128, 255, 128] : null;
    });
    const mask = pour20(line, 2, 2);
    expect(at(mask, 15, 15)).toBe(1);
    expect(at(mask, 15, 3)).toBe(0);
  });

  it('holds at a hard line a pixel wide, joined only by corners', () => {
    const wall = picture(20, 20, (x, y) => (x === y ? BLACK : null));
    const mask = pour20(wall, 15, 3);
    expect(at(mask, 18, 1)).toBe(1);
    expect(at(mask, 3, 15)).toBe(0);
  });

  it('holds at a tapering line a pixel wide, each pixel a little darker than the last', () => {
    const wall = picture(20, 20, (x, y) => (x + y === 19 ? [0, 0, 0, 120 + x * 4] : null));
    const mask = pour20(wall, 3, 3);
    expect(at(mask, 15, 15)).toBe(0);
  });

  it('holds at a smooth line from the paper on either side of it', () => {
    const line = picture(20, 20, (x, y) => {
      const off = Math.abs(x - y);
      return off === 0 ? BLACK : off === 1 ? [128, 128, 128] : null;
    });
    const mask = pour20(line, 15, 3);
    expect(at(mask, 3, 15)).toBe(0);
  });
});

describe('fillRegion and gaps', () => {
  const ringWithGap = (gap: number) => picture(20, 20, (x, y) => box(1, gap)[y * 20 + x] ? BLACK : null);

  it('leaks through a break when gaps are not held', () => {
    expect(at(pour20(ringWithGap(2), 7, 7, 25, 0), 0, 0)).toBe(1);
  });

  it('holds at a break no wider than the gap, and still reaches the corners', () => {
    const mask = pour20(ringWithGap(2), 7, 7, 25, 4);
    expect(at(mask, 0, 0)).toBe(0);
    expect(at(mask, 15, 15)).toBe(0);
    expect(at(mask, 3, 3)).toBe(1);
    expect(at(mask, 11, 11)).toBe(1);
  });

  it('fills the strip between a line and the sheet\'s edge', () => {
    const mask = pour20(ringWithGap(0), 16, 16, 25, 4);
    expect(at(mask, 0, 7)).toBe(1);
    expect(at(mask, 1, 7)).toBe(1);
    expect(at(mask, 7, 7)).toBe(0);
  });

  it('takes the thin tail of a line pressed on its thick part', () => {
    // A stroke with pressure: 8 pixels thick by x < 20, a pixel thin after.
    const stroke = picture(40, 20, (x, y) => ((x < 20 && y >= 6 && y < 14) || (x < 36 && y === 10) ? BLACK : null));
    const mask = fillRegion(colourDistance(stroke, 40, 20, 5, 10, WHITE), 40, 20, 5, 10, 25, 4);
    expect(mask[10 * 40 + 34]).toBe(1);
    expect(mask[10 * 40 + 38]).toBe(0);
  });
});

describe('growRim', () => {
  /** A row across a border: from the seed colour up the soft edge into the ink. */
  const row = (values: number[]) => {
    const distance = new Uint8Array(values.length * 3);
    values.forEach((v, x) => { for (let y = 0; y < 3; y++) distance[y * values.length + x] = v; });
    return distance;
  };
  const inRow = (values: number[], tolerance: number) => {
    const m = new Uint8Array(values.length * 3);
    // Only what the flood reaches: from the left, up to the first pixel past the tolerance.
    for (let x = 0; x < values.length && values[x] <= tolerance; x++) {
      for (let y = 0; y < 3; y++) m[y * values.length + x] = 1;
    }
    return m;
  };
  const row1 = (mask: Uint8Array, n: number) => [...mask.slice(n, 2 * n)];

  /** A mask of the row's length, set on every row for the columns `xs`. */
  const columns = (n: number, xs: number[]) => {
    const m = new Uint8Array(n * 3);
    for (let y = 0; y < 3; y++) for (const x of xs) m[y * n + x] = 1;
    return m;
  };
  const none = (n: number) => new Uint8Array(n * 3);

  const grow = (values: number[], steps: number, over: number[], paper: number[]) => {
    const n = values.length;
    const mask = inRow(values, 25);
    growRim(mask, row(values), n, 3, steps, columns(n, over), columns(n, paper));
    return row1(mask, n);
  };

  it('over a colour left uncovered, stops halfway up its soft edge', () => {
    expect(grow([0, 0, 80, 170, 255, 255, 255], 3, [], [])).toEqual([1, 1, 1, 0, 0, 0, 0]);
  });

  it('near empty paper, takes the whole soft edge and none of the paper', () => {
    const all = [0, 1, 2, 3, 4, 5, 6];
    expect(grow([0, 0, 80, 170, 255, 255, 255], 3, [], all)).toEqual([1, 1, 1, 1, 0, 0, 0]);
  });

  it('under ink, takes its soft edge and first solid pixel, no paper showing', () => {
    const all = [0, 1, 2, 3, 4, 5, 6];
    expect(grow([0, 0, 80, 170, 255, 255, 255], 3, all, [])).toEqual([1, 1, 1, 1, 1, 0, 0]);
  });

  it('never passes the peak of a thin line to its far side', () => {
    const all = [0, 1, 2, 3, 4, 5, 6];
    expect(grow([0, 0, 120, 200, 120, 0, 0], 3, all, [])).toEqual([1, 1, 1, 1, 0, 0, 0]);
  });

  it('takes nothing across a hard edge of an uncovered colour', () => {
    expect(grow([0, 0, 255, 255, 255], 3, [], [])).toEqual([1, 1, 0, 0, 0]);
  });

  it('eats nothing of a thin shape left uncovered', () => {
    expect(grow([0, 0, 150, 255, 150, 0, 0], 3, [], [])).toEqual([1, 1, 0, 0, 0, 0, 0]);
  });

  it('goes no further than its steps', () => {
    expect(grow([0, 40, 80, 120, 160, 200, 255], 2, [], [0, 1, 2, 3, 4, 5, 6])).toEqual([1, 1, 1, 0, 0, 0, 0]);
  });

  it('with nothing over it and no paper, takes the same as with empty masks', () => {
    const values = [0, 0, 80, 170, 255];
    const mask = inRow(values, 25);
    growRim(mask, row(values), 5, 3, 3, none(5), none(5));
    expect(row1(mask, 5)).toEqual([1, 1, 1, 0, 0]);
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

describe('oldFillsIn', () => {
  const tools: ToolDescriptor[] = [
    { kind: 'pencil', geometry: 'line', width: 2, color: '#000000' },
    { kind: 'contour', geometry: 'line', color: '#ff0000' },
  ];
  const line = (...points: number[]) => ({ points, tool_id: 0 });
  const fill = (...points: number[]) => ({ points, tool_id: 1 });
  // The area: the block 5..9 × 5..9 of a 20×20 sheet; its outline runs 5..10.
  const area = new Uint8Array(400);
  for (let y = 5; y < 10; y++) for (let x = 5; x < 10; x++) area[y * 20 + x] = 1;
  const old = (strokes: { points: number[]; tool_id: number }[]) => oldFillsIn(area, 20, 20, strokes, tools, 1);

  it('finds an old fill of the same area, wherever it lay', () => {
    expect(old([fill(5, 5, 10, 5, 10, 10, 5, 10), line(4, 0, 4, 19)])).toEqual([0]);
    expect(old([line(4, 0, 4, 19), fill(5, 5, 10, 5, 10, 10, 5, 10)])).toEqual([1]);
  });

  it('finds one traced a pixel or two wider, and keeps one that reaches beyond', () => {
    expect(old([fill(4, 3, 11, 4, 11, 11, 4, 11)])).toEqual([0]);
    expect(old([fill(5, 5, 15, 5, 15, 10, 5, 10)])).toEqual([]);
  });

  it('keeps a fill whose edge lies in the area and whose middle does not', () => {
    // The area is a ring, as a line pressed on is; the old fill is what it encloses.
    const ring = new Uint8Array(400);
    for (let y = 2; y <= 17; y++) {
      for (let x = 2; x <= 17; x++) if (x < 5 || x > 14 || y < 5 || y > 14) ring[y * 20 + x] = 1;
    }
    expect(oldFillsIn(ring, 20, 20, [fill(4, 4, 16, 4, 16, 16, 4, 16)], tools, 1)).toEqual([]);
  });

  it('never takes a line, however deep inside', () => {
    expect(old([line(6, 6, 8, 8)])).toEqual([]);
  });
});

describe('recolouredFill', () => {
  const tools: ToolDescriptor[] = [
    { kind: 'pencil', geometry: 'line', width: 2, color: '#000000' },
    { kind: 'contour', geometry: 'line', color: '#ff0000' },
    { kind: 'contour', geometry: 'smooth', color: '#ff0000' },
  ];
  const square = (tool_id: number) => ({ points: [5, 5, 15, 5, 15, 15, 5, 15], tool_id });
  const block = (x0: number, x1: number) => {
    const pure: number[] = [];
    for (let y = 5; y < 15; y++) for (let x = x0; x < x1; x++) pure.push(y * 20 + x);
    return pure;
  };

  it('is the old fill when the colour pressed is that fill and nothing else', () => {
    expect(recolouredFill(block(5, 15), [1], [square(0), square(1)], tools, 1, 20, 20)).toBe(1);
  });

  it('is none when the same colour runs on past the fill', () => {
    expect(recolouredFill(block(5, 19), [0], [square(1)], tools, 1, 20, 20)).toBeNull();
  });

  it('is none when several old fills make up the area', () => {
    expect(recolouredFill(block(5, 15), [0, 1], [square(1), square(1)], tools, 1, 20, 20)).toBeNull();
  });

  it('is none for a curved contour, which the bucket did not lay down', () => {
    expect(recolouredFill(block(5, 15), [0], [square(2)], tools, 1, 20, 20)).toBeNull();
  });
});

describe('lowestSeenSlot', () => {
  /** A stack where the fill is seen on `whole` pixels from slot `from` up. */
  const seenFrom = (from: number, whole = 100) => (slot: number) => (slot >= from ? whole : whole - (from - slot));

  it('goes to the very bottom when nothing covers it there', () => {
    expect(lowestSeenSlot(5, seenFrom(0))).toBe(0);
  });

  it('goes right over the last stroke that would cover it', () => {
    expect(lowestSeenSlot(5, seenFrom(3))).toBe(3);
  });

  it('goes on top when every slot under it loses a pixel', () => {
    expect(lowestSeenSlot(5, seenFrom(5))).toBe(5);
  });

  it('takes the empty stack', () => {
    expect(lowestSeenSlot(0, seenFrom(0))).toBe(0);
  });

  it('asks about as few slots as a bisection does', () => {
    let asked = 0;
    lowestSeenSlot(1000, (slot) => {
      asked++;
      return seenFrom(617)(slot);
    });
    expect(asked).toBeLessThanOrEqual(12);
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

describe('smoothRing', () => {
  /** The ring round a disc of radius `r` in a sheet of its size, from its pixels. */
  const disc = (r: number) => {
    const size = 2 * r + 6;
    const mask = new Uint8Array(size * size);
    const c = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) if (Math.hypot(x + 0.5 - c, y + 0.5 - c) <= r) mask[y * size + x] = 1;
    }
    return { ring: traceOutline(mask, size, size), c };
  };

  it('takes a circle down to a few dozen points that keep to the true edge', () => {
    const { ring, c } = disc(150);
    const smooth = smoothRing(ring);
    expect(smooth.length / 2).toBeLessThan(90);
    for (let i = 0; i < smooth.length; i += 2) {
      expect(Math.abs(Math.hypot(smooth[i] - c, smooth[i + 1] - c) - 150)).toBeLessThan(0.9);
    }
    // Between its points too: the true edge never bulges past a chord by a pixel.
    const n = smooth.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const mx = (smooth[2 * i] + smooth[2 * j]) / 2;
      const my = (smooth[2 * i + 1] + smooth[2 * j + 1]) / 2;
      expect(Math.abs(Math.hypot(mx - c, my - c) - 150)).toBeLessThan(1);
    }
  });

  it('keeps the corners of a block exactly', () => {
    expect(smoothRing([3, 2, 30, 2, 30, 25, 3, 25])).toEqual([3, 2, 30, 2, 30, 25, 3, 25]);
  });

  it('keeps a thin straight bar as wide along its length', () => {
    const smooth = smoothRing([0, 0, 100, 0, 100, 2, 0, 2]);
    expect(smooth).toContainEqual(100);
    for (let i = 1; i < smooth.length; i += 2) expect([0, 1, 2]).toContain(smooth[i]);
    expect(smooth.filter((v, i) => i % 2 === 1 && v === 0).length).toBe(2);
    expect(smooth.filter((v, i) => i % 2 === 1 && v === 2).length).toBe(2);
  });

  it('keeps a corner where a stair meets a long side', () => {
    // A long flat top, a long right side and one little step cut out of its far corner.
    const smooth = smoothRing([0, 0, 40, 0, 40, 39, 39, 39, 39, 40, 0, 40]);
    expect(smooth.slice(0, 4)).toEqual([0, 0, 40, 0]);
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
