import { describe, expect, test } from 'bun:test';

import { shapePoints, shapeStroke } from './shapes';

const free = { square: false, fromCentre: false, sides: 3 };

describe('shapePoints', () => {
  test('a line runs from the press to the pointer', () => {
    expect(shapePoints('line', [10, 20], [110, 70], free)).toEqual([10, 20, 110, 70]);
  });

  test('a rectangle is the frame of the two points, closed, from its top left clockwise', () => {
    expect(shapePoints('rect', [10, 10], [110, 60], free)).toEqual([10, 10, 110, 10, 110, 60, 10, 60, 10, 10]);
  });

  test('a rectangle dragged up and to the left is the same rectangle', () => {
    expect(shapePoints('rect', [110, 60], [10, 10], free)).toEqual([10, 10, 110, 10, 110, 60, 10, 60, 10, 10]);
  });

  test('Shift makes a square of the longer side, from the press towards the pointer', () => {
    const square = { ...free, square: true };
    expect(shapePoints('rect', [0, 0], [100, 40], square)).toEqual([0, 0, 100, 0, 100, 100, 0, 100, 0, 0]);
    expect(shapePoints('rect', [0, 0], [-40, -100], square)).toEqual([-100, -100, 0, -100, 0, 0, -100, 0, -100, -100]);
  });

  test('Alt makes the press the centre of the frame', () => {
    const centred = { ...free, fromCentre: true };
    expect(shapePoints('rect', [50, 50], [80, 70], centred)).toEqual([20, 30, 80, 30, 80, 70, 20, 70, 20, 30]);
  });

  test('Alt makes the press the middle of a line', () => {
    expect(shapePoints('line', [50, 50], [80, 70], { ...free, fromCentre: true })).toEqual([20, 30, 80, 70]);
  });

  test('Shift turns a line to the nearest 15°, its length kept, in whole document units', () => {
    const snapped = { ...free, square: true };
    // 100 long at 40°: laid at 45°.
    expect(shapePoints('line', [0, 0], [76.6, 64.3], snapped)).toEqual([0, 0, 71, 71]);
    // Almost flat: flat.
    expect(shapePoints('line', [0, 0], [100, 5], snapped)).toEqual([0, 0, 100, 0]);
  });

  test('an ellipse from the centre has the semi-axes of the drag, closed, every point on it', () => {
    const points = shapePoints('ellipse', [400, 400], [640, 560], { ...free, fromCentre: true });
    expect(points.slice(0, 2)).toEqual(points.slice(-2));
    for (let i = 0; i < points.length; i += 2) {
      const r = Math.hypot((points[i] - 400) / 240, (points[i + 1] - 400) / 160);
      expect(Math.abs(r - 1)).toBeLessThan(0.01);
    }
  });

  test('a big circle looks round: no chord is further than 0.25 px (2 units) inside it', () => {
    const radius = 2800;
    const points = shapePoints('ellipse', [0, 0], [2 * radius, 2 * radius], free);
    for (let i = 2; i < points.length; i += 2) {
      const mx = (points[i - 2] + points[i]) / 2 - radius;
      const my = (points[i - 1] + points[i + 1]) / 2 - radius;
      // Rounding to whole units may take one more unit off.
      expect(radius - Math.hypot(mx, my)).toBeLessThanOrEqual(3);
    }
  });

  test('a tiny circle still has 16 segments, a huge one no more than 256', () => {
    expect(shapePoints('ellipse', [0, 0], [8, 8], free).length).toBe(2 * 17);
    expect(shapePoints('ellipse', [0, 0], [64000, 64000], free).length).toBe(2 * 257);
  });

  test('a triangle fills the frame, a vertex up, clockwise, closed', () => {
    expect(shapePoints('polygon', [0, 0], [120, 120], free)).toEqual([60, 0, 120, 120, 0, 120, 60, 0]);
  });

  test('with Shift the polygon is regular, fitted into the square in its middle', () => {
    expect(shapePoints('polygon', [0, 0], [120, 50], { ...free, square: true }))
      .toEqual([60, 8, 120, 112, 0, 112, 60, 8]);
  });

  test('a hexagon has six corners; sides outside 3–12 are held to them', () => {
    expect(shapePoints('polygon', [0, 0], [100, 100], { ...free, sides: 6 }).length).toBe(2 * 7);
    expect(shapePoints('polygon', [0, 0], [100, 100], { ...free, sides: 1 }).length).toBe(2 * 4);
    expect(shapePoints('polygon', [0, 0], [100, 100], { ...free, sides: 40 }).length).toBe(2 * 13);
  });
});

describe('the format range', () => {
  test('a shape framed past the int16 range is held inside it, as a brush stroke is', () => {
    // A Shift square near the edge of a 32767-wide sheet runs past it.
    const points = shapePoints('rect', [30000, 1000], [31000, 5000], { ...free, square: true });
    expect(Math.max(...points)).toBe(32767);
    expect(shapePoints('line', [0, 0], [-40000, 50000], free)).toEqual([0, 0, -32768, 32767]);
  });
});

describe('shapeStroke', () => {
  const brush = { width: 72, color: '#112233', fill: '#ff0000', opacity: 100 };

  test('an outline is a pencil line, read as corners, at the brush width and colour, with no pressure', () => {
    expect(shapeStroke('rect', [0, 0], [80, 40], free, { ...brush, filled: false })).toEqual({
      points: [0, 0, 80, 0, 80, 40, 0, 40, 0, 0],
      tool: { kind: 'pencil', geometry: 'line', width: 72, color: '#112233' },
    });
  });

  test('a filled shape is a feather: filled with the fill colour, stroked with the line colour', () => {
    expect(shapeStroke('rect', [0, 0], [80, 40], free, { ...brush, filled: true })?.tool)
      .toEqual({ kind: 'feather', geometry: 'line', width: 72, color: '#112233', fill: '#ff0000' });
  });

  test('a line is never filled', () => {
    expect(shapeStroke('line', [0, 0], [80, 40], free, { ...brush, filled: true })?.tool.kind).toBe('pencil');
  });

  test('a faint brush lays a faint shape', () => {
    expect(shapeStroke('ellipse', [0, 0], [80, 40], free, { ...brush, opacity: 40, filled: false })?.tool)
      .toMatchObject({ opacity: 40 });
  });

  test('a drag that framed nothing lays nothing', () => {
    expect(shapeStroke('rect', [10, 10], [10, 10], free, { ...brush, filled: false })).toBeNull();
    expect(shapeStroke('line', [10, 10], [10, 10], free, { ...brush, filled: false })).toBeNull();
  });
});
