import { describe, expect, test } from 'bun:test';

import { applyMatrix } from '../model/geom';
import {
  EMPTY_TRANSFORM,
  nudged,
  selectStrokes,
  selectionBounds,
  sessionMatrix,
  sessionWidthScale,
  boxCorners,
  cornerAt,
  movedCorner,
} from './lasso';

const strokes = [
  { points: [10, 10, 20, 20], tool_id: 0 },
  { points: [200, 200, 210, 210], tool_id: 0 },
  { points: [20, 20, 300, 300], tool_id: 0 },
];

/** A square over the top-left corner: touches strokes 0 and 2, misses 1. */
const corner = [0, 0, 50, 0, 50, 50, 0, 50];

describe('selectStrokes', () => {
  test('takes a stroke when any of its points is inside the polygon', () => {
    expect(selectStrokes(strokes, corner)).toEqual([0, 2]);
  });

  test('a polygon over empty space selects nothing', () => {
    expect(selectStrokes(strokes, [400, 400, 450, 400, 450, 450, 400, 450])).toEqual([]);
  });

  test('a polygon with fewer than three corners selects nothing', () => {
    expect(selectStrokes(strokes, [0, 0, 50, 50])).toEqual([]);
  });
});

describe('selectionBounds', () => {
  test('covers every point of the chosen strokes', () => {
    expect(selectionBounds(strokes, [0, 2])).toEqual({ x: 10, y: 10, width: 290, height: 290 });
  });

  test('an empty selection has no box', () => {
    expect(selectionBounds(strokes, [])).toBeNull();
  });

  test('a single point still yields a box, so the handles have somewhere to sit', () => {
    expect(selectionBounds([{ points: [7, 9] }], [0]))
      .toEqual({ x: 7, y: 9, width: 0, height: 0 });
  });
});

describe('sessionMatrix', () => {
  const box = { x: 0, y: 0, width: 100, height: 100 };

  test('a fresh session moves nothing', () => {
    expect(applyMatrix(sessionMatrix(EMPTY_TRANSFORM, box), 30, 40)).toEqual([30, 40]);
  });

  test('accumulated offsets shift the selection', () => {
    const m = sessionMatrix({ ...EMPTY_TRANSFORM, dx: 5, dy: -5 }, box);
    expect(applyMatrix(m, 30, 40)).toEqual([35, 35]);
  });

  test('rotation turns about the centre of the selection box, not the canvas', () => {
    const m = sessionMatrix({ ...EMPTY_TRANSFORM, rotate: 90 }, box);
    const [x, y] = applyMatrix(m, 100, 50);
    expect(x).toBeCloseTo(50, 6);
    expect(y).toBeCloseTo(100, 6);
  });

  test('scale doubles the distance from the centre of the box', () => {
    const m = sessionMatrix({ ...EMPTY_TRANSFORM, scaleX: 2, scaleY: 2 }, box);
    expect(applyMatrix(m, 100, 100)).toEqual([150, 150]);
  });

  test('a mirror is a negative scale about the same centre', () => {
    const m = sessionMatrix({ ...EMPTY_TRANSFORM, scaleX: -1 }, box);
    expect(applyMatrix(m, 80, 10)).toEqual([20, 10]);
  });
});

describe('sessionWidthScale', () => {
  test('is the mean of the axis scales, so a uniform 200% doubles the width', () => {
    expect(sessionWidthScale({ ...EMPTY_TRANSFORM, scaleX: 2, scaleY: 2 })).toBe(2);
  });

  test('ignores the sign, because a mirror is not a thinner line', () => {
    expect(sessionWidthScale({ ...EMPTY_TRANSFORM, scaleX: -2, scaleY: -2 })).toBe(2);
  });

  test('averages a non-uniform scale', () => {
    expect(sessionWidthScale({ ...EMPTY_TRANSFORM, scaleX: 3, scaleY: 1 })).toBe(2);
  });
});

describe('nudged', () => {
  test('an arrow moves by one document unit, with shift by ten', () => {
    expect(nudged(EMPTY_TRANSFORM, 'move', 1, false).dx).toBe(1);
    expect(nudged(EMPTY_TRANSFORM, 'move', 1, true).dx).toBe(10);
    expect(nudged(EMPTY_TRANSFORM, 'move', -1, false, 'y').dy).toBe(-1);
  });

  test('Q and W turn the selection, with shift turning further', () => {
    expect(nudged(EMPTY_TRANSFORM, 'rotate', -1, false).rotate).toBe(-1);
    expect(nudged(EMPTY_TRANSFORM, 'rotate', 1, true).rotate).toBe(15);
  });

  test('plus and minus step the scale on both axes together', () => {
    const grown = nudged(EMPTY_TRANSFORM, 'scale', 1, false);
    expect(grown.scaleX).toBeCloseTo(1.1, 6);
    expect(grown.scaleY).toBeCloseTo(1.1, 6);
  });

  test('shrinking cannot flip the selection inside out', () => {
    let session = EMPTY_TRANSFORM;
    for (let i = 0; i < 100; i++) {
      session = nudged(session, 'scale', -1, false);
    }
    expect(session.scaleX).toBeGreaterThan(0);
  });

  test('a nudge leaves the other fields alone', () => {
    const session = nudged({ ...EMPTY_TRANSFORM, rotate: 30 }, 'move', 1, false);
    expect(session.rotate).toBe(30);
    expect(session.scaleX).toBe(1);
  });
});

describe('boxCorners', () => {
  test('lists the corners clockwise from the top left', () => {
    expect(boxCorners({ x: 10, y: 20, width: 100, height: 50 }))
      .toEqual([10, 20, 110, 20, 110, 70, 10, 70]);
  });
});

describe('cornerAt', () => {
  const quad = [0, 0, 100, 0, 100, 100, 0, 100];

  test('finds the corner under the pointer within the grab radius', () => {
    expect(cornerAt(quad, 103, 97, 8)).toBe(2);
  });

  test('is null away from every corner, so a drag starts a move instead', () => {
    expect(cornerAt(quad, 50, 50, 8)).toBeNull();
  });

  test('picks the nearest when two are within reach', () => {
    expect(cornerAt([0, 0, 4, 0, 4, 4, 0, 4], 3, 1, 8)).toBe(1);
  });
});

describe('movedCorner', () => {
  const quad = [0, 0, 100, 0, 100, 100, 0, 100];

  test('moves one corner and leaves the other three', () => {
    expect(movedCorner(quad, 2, 100, 150)).toEqual([0, 0, 100, 0, 100, 150, 0, 100]);
  });

  test('returns a new array, so the original quad stays around for Esc', () => {
    movedCorner(quad, 0, 9, 9);
    expect(quad[0]).toBe(0);
  });
});
