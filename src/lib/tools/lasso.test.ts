import { describe, expect, test } from 'bun:test';

import { applyMatrix } from '../model/geom';
import {
  EMPTY_TRANSFORM,
  hitMode,
  movedBy,
  nudged,
  rotatedTo,
  scaledBy,
  selectionBounds,
  sessionMatrix,
  sessionWidthScale,
} from './lasso';

const strokes = [
  { points: [10, 10, 20, 20], tool_id: 0 },
  { points: [200, 200, 210, 210], tool_id: 0 },
  { points: [20, 20, 300, 300], tool_id: 0 },
];


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
  test('is the smaller axis scale, so a uniform 200% doubles the width', () => {
    expect(sessionWidthScale({ ...EMPTY_TRANSFORM, scaleX: 2, scaleY: 2 })).toBe(2);
  });

  test('ignores the sign, because a mirror is not a thinner line', () => {
    expect(sessionWidthScale({ ...EMPTY_TRANSFORM, scaleX: -2, scaleY: -2 })).toBe(2);
  });

  test('takes the lesser of a non-uniform scale (reference min, not mean)', () => {
    expect(sessionWidthScale({ ...EMPTY_TRANSFORM, scaleX: 3, scaleY: 1 })).toBe(1);
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

  test('plus steps the larger axis by one percent and the other in proportion', () => {
    const grown = nudged({ ...EMPTY_TRANSFORM, scaleX: 2, scaleY: 1 }, 'scale', 1, false);
    expect(grown.scaleX).toBeCloseTo(2.01, 6);
    expect(grown.scaleY).toBeCloseTo(1.005, 6);
  });

  test('shift steps by five percent', () => {
    const grown = nudged({ ...EMPTY_TRANSFORM, scaleX: 2, scaleY: 1 }, 'scale', 1, true);
    expect(grown.scaleX).toBeCloseTo(2.05, 6);
    expect(grown.scaleY).toBeCloseTo(1.025, 6);
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

/** The reference's own example frame: 100x50 at the origin, centre (50, 25). */
const box = { x: 0, y: 0, width: 100, height: 50 };

describe('hitMode', () => {
  test('the body moves, the edges and corners scale', () => {
    expect(hitMode(50, 25, box, EMPTY_TRANSFORM, 1)).toBe('move');
    expect(hitMode(100, 25, box, EMPTY_TRANSFORM, 1)).toBe('scale-r');
    expect(hitMode(0, 25, box, EMPTY_TRANSFORM, 1)).toBe('scale-l');
    expect(hitMode(50, 0, box, EMPTY_TRANSFORM, 1)).toBe('scale-u');
    expect(hitMode(50, 50, box, EMPTY_TRANSFORM, 1)).toBe('scale-d');
    expect(hitMode(100, 50, box, EMPTY_TRANSFORM, 1)).toBe('scale-dr');
    expect(hitMode(0, 0, box, EMPTY_TRANSFORM, 1)).toBe('scale-ul');
  });

  test('just outside a corner turns instead of scaling', () => {
    expect(hitMode(120, 60, box, EMPTY_TRANSFORM, 1)).toBe('rotate');
  });

  test('far from every corner is not the transform at all', () => {
    expect(hitMode(200, 25, box, EMPTY_TRANSFORM, 1)).toBe('none');
  });

  test('zoom shrinks the thresholds, so a zoomed-in handle is not a fat target', () => {
    // 10 document units off the right edge is a handle at zoom 1, the body at zoom 4.
    expect(hitMode(90, 25, box, EMPTY_TRANSFORM, 1)).toBe('scale-r');
    expect(hitMode(90, 25, box, EMPTY_TRANSFORM, 4)).toBe('move');
  });

  test('a turned frame is hit in its own coordinates', () => {
    // At 90 deg the frame's "top" handle sits to the right of the centre.
    const turned = { ...EMPTY_TRANSFORM, rotate: 90 };
    expect(hitMode(75, 25, box, turned, 1)).toBe('scale-u');
    expect(hitMode(50, -25, box, turned, 1)).toBe('scale-l');
  });

  test('the scaled frame carries its handles with it', () => {
    // Doubled on X, the right handle sits at 150, and the old edge is body.
    const grown = { ...EMPTY_TRANSFORM, scaleX: 2 };
    expect(hitMode(150, 25, box, grown, 1)).toBe('scale-r');
    expect(hitMode(100, 25, box, grown, 1)).toBe('move');
  });
});

describe('movedBy', () => {
  test('the body follows the pointer from where the drag started', () => {
    const moved = movedBy(EMPTY_TRANSFORM, { x: 10, y: 10 }, { x: 30, y: 5 }, false, null);
    expect(moved.session.dx).toBe(20);
    expect(moved.session.dy).toBe(-5);
    expect(moved.axis).toBeNull();
  });

  test('shift locks the axis the first dominant move picked and keeps it', () => {
    const first = movedBy(EMPTY_TRANSFORM, { x: 0, y: 0 }, { x: 20, y: 0 }, true, null);
    expect(first.axis).toBe('x');
    const second = movedBy(EMPTY_TRANSFORM, { x: 0, y: 0 }, { x: 20, y: 5 }, true, first.axis);
    expect(second.session.dx).toBe(20);
    expect(second.session.dy).toBe(0);
  });

  test('letting shift go frees the axis again', () => {
    const free = movedBy(EMPTY_TRANSFORM, { x: 0, y: 0 }, { x: 20, y: 5 }, false, 'x');
    expect(free.session.dy).toBe(5);
    expect(free.axis).toBeNull();
  });

  test('a drag adds to the offset the session already had', () => {
    const moved = movedBy({ ...EMPTY_TRANSFORM, dx: 7 }, { x: 0, y: 0 }, { x: 3, y: 0 }, false, null);
    expect(moved.session.dx).toBe(10);
  });
});

describe('rotatedTo', () => {
  /** A point `deg` around the centre of `box` at radius 100. */
  function around(deg: number): { x: number; y: number } {
    const a = (deg * Math.PI) / 180;
    return { x: 50 + 100 * Math.cos(a), y: 25 + 100 * Math.sin(a) };
  }

  test('the selection turns by the angle the pointer swept', () => {
    expect(rotatedTo(EMPTY_TRANSFORM, box, around(0), around(37), false).rotate).toBeCloseTo(37, 6);
  });

  test('ctrl snaps the angle down to a multiple of fifteen degrees', () => {
    expect(rotatedTo(EMPTY_TRANSFORM, box, around(0), around(37), true).rotate).toBe(30);
  });

  test('the sweep adds to the angle the session already had', () => {
    const turned = rotatedTo({ ...EMPTY_TRANSFORM, rotate: 10 }, box, around(0), around(20), false);
    expect(turned.rotate).toBeCloseTo(30, 6);
  });
});

describe('scaledBy', () => {
  test('a side handle stretches one axis and leaves the other', () => {
    const s = scaledBy(EMPTY_TRANSFORM, box, 'scale-r', { x: 100, y: 25 }, { x: 150, y: 25 }, false);
    expect(s.scaleX).toBeCloseTo(2, 6);
    expect(s.scaleY).toBe(1);
  });

  test('the left handle grows the selection when it is dragged outwards', () => {
    const s = scaledBy(EMPTY_TRANSFORM, box, 'scale-l', { x: 0, y: 25 }, { x: -50, y: 25 }, false);
    expect(s.scaleX).toBeCloseTo(2, 6);
  });

  test('a corner takes both axes', () => {
    const s = scaledBy(EMPTY_TRANSFORM, box, 'scale-dr', { x: 100, y: 50 }, { x: 125, y: 62.5 }, false);
    expect(s.scaleX).toBeCloseTo(1.5, 6);
    expect(s.scaleY).toBeCloseTo(1.5, 6);
  });

  test('shift on a corner keeps the ratio the session started with', () => {
    const s = scaledBy(EMPTY_TRANSFORM, box, 'scale-dr', { x: 100, y: 50 }, { x: 125, y: 50 }, true);
    expect(s.scaleX).toBeCloseTo(1.5, 6);
    expect(s.scaleY).toBeCloseTo(1.5, 6);
  });

  test('a turned frame scales along its own axes', () => {
    const turned = { ...EMPTY_TRANSFORM, rotate: 90 };
    // The right handle of a frame turned 90 deg points down the screen.
    const s = scaledBy(turned, box, 'scale-r', { x: 50, y: 75 }, { x: 50, y: 125 }, false);
    expect(s.scaleX).toBeCloseTo(2, 6);
    expect(s.scaleY).toBe(1);
  });
});
