import { describe, expect, test } from 'bun:test';

import { alongRuler, hitRuler, movedRuler, rulerAcross, turnedRuler, type Ruler } from './ruler';

/** Lying flat through (1000, 1000), 800 units long; one unit is one screen pixel. */
const flat: Ruler = { x: 1000, y: 1000, angle: 0, length: 800 };

describe('hitRuler', () => {
  test('a press on the body takes the body, on an end the end, beside an edge the edge, far away nothing', () => {
    expect(hitRuler(flat, [1000, 1005], 1)).toEqual({ part: 'body' });
    expect(hitRuler(flat, [1395, 1000], 1)).toEqual({ part: 'end', end: 1 });
    expect(hitRuler(flat, [605, 1000], 1)).toEqual({ part: 'end', end: -1 });
    // The body is 36 px thick: the edges are 18 px off the middle, the catch 24 px past them.
    expect(hitRuler(flat, [1000, 1030], 1)).toEqual({ part: 'edge' });
    expect(hitRuler(flat, [1000, 970], 1)).toEqual({ part: 'edge' });
    expect(hitRuler(flat, [1000, 1100], 1)).toBeNull();
    expect(hitRuler(flat, [1500, 1000], 1)).toBeNull();
  });

  test('the zones are screen pixels: zoomed out to 8 units a pixel, the edge catch is 8 times wider on the sheet', () => {
    const long: Ruler = { ...flat, length: 8000 };
    expect(hitRuler(long, [1000, 1000 + 30 * 8], 8)).toEqual({ part: 'edge' });
    expect(hitRuler(long, [1000, 1000 + 50 * 8], 8)).toBeNull();
  });

  test('a ruler standing up is hit along its own length', () => {
    const upright: Ruler = { ...flat, angle: Math.PI / 2 };
    expect(hitRuler(upright, [1000, 1395], 1)).toEqual({ part: 'end', end: 1 });
    expect(hitRuler(upright, [1030, 1000], 1)).toEqual({ part: 'edge' });
    expect(hitRuler(upright, [1395, 1000], 1)).toBeNull();
  });
});

describe('alongRuler', () => {
  test('every point goes onto the line through the press, parallel to the ruler', () => {
    const lay = alongRuler({ ...flat, angle: Math.PI / 4 }, [0, 0]);
    const [x, y] = lay([10, 0]);
    expect(x).toBeCloseTo(5);
    expect(y).toBeCloseTo(5);
    const flatLay = alongRuler(flat, [100, 1030]);
    expect(flatLay([400, 1047])).toEqual([400, 1030]);
  });
});

describe('moving and turning', () => {
  test('a drag of the body carries the ruler by the drag, its angle kept', () => {
    expect(movedRuler(flat, [1000, 1000], [1100, 950])).toEqual({ ...flat, x: 1100, y: 950 });
  });

  test('an end dragged turns the ruler about the other end, its length kept', () => {
    // The −1 end is at (600, 1000); the +1 end is pulled straight up from it.
    const turned = turnedRuler(flat, 1, [600, 0], 'free');
    expect(turned.angle).toBeCloseTo(-Math.PI / 2);
    expect(turned.length).toBe(800);
    expect(turned.x).toBeCloseTo(600);
    expect(turned.y).toBeCloseTo(600);
  });

  test('the −1 end turns about the +1 end', () => {
    // The +1 end stays at (1400, 1000); the −1 end pulled to its right.
    const turned = turnedRuler(flat, -1, [2000, 1000], 'free');
    expect(turned.x).toBeCloseTo(1800);
    expect(turned.y).toBeCloseTo(1000);
  });

  test('a finger is pulled onto a 15° step when it is within 40 screen px of it, at most 5° (it has no Shift)', () => {
    const deg = (d: number) => (d * Math.PI) / 180;
    // The finger `r` sheet units from the fixed end at (600, 1000), at `d` degrees.
    const at = (d: number, r: number): [number, number] => [600 + r * Math.cos(deg(d)), 1000 + r * Math.sin(deg(d))];
    // 800 px out, 1° off 45° is 14 px: pulled. 7° off is 98 px: free.
    expect(turnedRuler(flat, 1, at(44, 800), 'pull', 1).angle).toBeCloseTo(deg(45));
    expect(turnedRuler(flat, 1, at(38, 800), 'pull', 1).angle).toBeCloseTo(deg(38));
    // Zoomed in four times the same finger is 3200 px out: 1° off is 56 px, free.
    expect(turnedRuler(flat, 1, at(44, 800), 'pull', 0.25).angle).toBeCloseTo(deg(44));
    // 200 px out, 40 px would be 11°; the pull stops at 5°: 4° off is pulled, 6° is not.
    expect(turnedRuler(flat, 1, at(41, 200), 'pull', 1).angle).toBeCloseTo(deg(45));
    expect(turnedRuler(flat, 1, at(39, 200), 'pull', 1).angle).toBeCloseTo(deg(39));
    // A mouse or a pen turns it freely: the even angle is Shift's.
    expect(turnedRuler(flat, 1, at(44, 800), 'free', 1).angle).toBeCloseTo(deg(44));
  });

  test('with Shift the angle goes by 15°', () => {
    // Pulled to 40° below flat: laid at 45°.
    const turned = turnedRuler(flat, 1, [600 + 766, 1000 + 643], 'step');
    expect(turned.angle).toBeCloseTo(Math.PI / 4);
  });
});

describe('rulerAcross', () => {
  test('lies flat through the middle of the part of the sheet in view, over most of its width', () => {
    // The sheet is 0–10240 × 0–5760; the view shows 5000–20000 × 1000–3000 of the table.
    expect(rulerAcross({ left: 5000, top: 1000, right: 20000, bottom: 3000 }, 10240, 5760))
      .toEqual({ x: 7620, y: 2000, angle: 0, length: 4192 });
  });
});
