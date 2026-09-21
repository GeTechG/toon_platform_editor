import { SQUARE_STAMP } from '../format/types';
import { describe, expect, it } from 'bun:test';
import { eraseStrokes } from './mega-eraser';

const line = (points: number[], tool_id = 0) => ({ points, tool_id });

describe('eraseStrokes', () => {
  it('leaves a stroke the gesture never reaches untouched', () => {
    const strokes = [line([0, 0, 100, 0])];
    expect(eraseStrokes(strokes, [0, 500, 100, 500], 10)).toEqual(strokes);
  });

  it('cuts a stroke in two where the capsule crosses it, keeping the tool', () => {
    const result = eraseStrokes([line([0, 0, 100, 0], 3)], [50, -50, 50, 50], 10);
    expect(result).toHaveLength(2);
    expect(result.every((piece) => piece.tool_id === 3)).toBe(true);
    const [left, right] = result;
    expect(left.points[0]).toBe(0);
    expect(left.points.at(-2)).toBeCloseTo(40, 0);
    expect(right.points[0]).toBeCloseTo(60, 0);
    expect(right.points.at(-2)).toBe(100);
  });

  it('trims a stroke whose end lies inside the capsule', () => {
    const result = eraseStrokes([line([0, 0, 100, 0])], [100, -50, 100, 50], 20);
    expect(result).toHaveLength(1);
    expect(result[0].points[0]).toBe(0);
    expect(result[0].points.at(-2)).toBeCloseTo(80, 0);
  });

  it('drops a stroke that lies entirely inside the capsule', () => {
    expect(eraseStrokes([line([0, 0, 40, 0])], [-10, 0, 50, 0], 30)).toEqual([]);
  });

  it('drops a dot inside the capsule and keeps one outside', () => {
    expect(eraseStrokes([line([0, 0]), line([200, 0])], [0, 0, 10, 0], 20)).toEqual([line([200, 0])]);
  });

  it('keeps integer coordinates — the format has no room for anything else', () => {
    const result = eraseStrokes([line([0, 0, 100, 3])], [50, -50, 50, 50], 7);
    for (const piece of result) {
      expect(piece.points.every(Number.isInteger)).toBe(true);
    }
  });

  it('erases nothing for an empty gesture', () => {
    const strokes = [line([0, 0, 100, 0])];
    expect(eraseStrokes(strokes, [], 10)).toEqual(strokes);
  });
});

describe('eraseStrokes by primitive', () => {
  // What the tool that lays down the primitive says about being cut — the
  // eraser itself knows only the contour, which no tool lays down. A tool
  // that stamps independent marks asks for its cells to be taken; which tool
  // that is the eraser never learns, so the test stands in for one.
  const cutOf = (tool: { kind: string }) => (tool.kind === 'stamp' ? 'cells' : undefined);

  const pixelTools = [{ kind: 'stamp', geometry: 'line', width: 10, color: '#000000', shape: SQUARE_STAMP }] as const;
  const contourTools = [
    { kind: 'contour', geometry: 'smooth', color: '#000000' },
    { kind: 'pencil', geometry: 'smooth', width: 4, color: '#000000' },
  ] as const;
  /** Cells of width 10 in a row; a point is a cell's corner, so its centre is +5. */
  const cells = [0, 0, 10, 0, 20, 0, 30, 0, 40, 0];

  it('takes the cells the capsule covers and leaves the rest on the grid', () => {
    const result = eraseStrokes([line(cells)], [25, -50, 25, 50], 6, pixelTools, cutOf);

    expect(result).toHaveLength(2);
    expect(result[0].points).toEqual([0, 0, 10, 0]);
    expect(result[1].points).toEqual([30, 0, 40, 0]);
    // Every coordinate is still a multiple of the cell, so every square the
    // renderer fills lines up with the ones that were not erased.
    for (const piece of result) {
      expect(piece.points.every((value) => value % 10 === 0)).toBe(true);
    }
  });

  it('cuts the cells the renderer fills between two stored ones', () => {
    // Capture stores only the cells the pointer actually visited; the renderer
    // fills the gaps (interpolatePixelLine). An erase that ignored them would
    // leave the drawn line unbroken — the stored points would part, and the
    // interpolation would join them right back up.
    const sparse = [0, 0, 100, 0];

    const result = eraseStrokes([line(sparse)], [55, 5, 55, 5], 6, pixelTools, cutOf);

    expect(result.length).toBeGreaterThan(1);
    const drawn = result.flatMap((piece) => piece.points);
    expect(drawn).toContain(0);
    expect(drawn).toContain(100);
    expect(drawn).not.toContain(50);
    expect(drawn.every((value) => value % 10 === 0)).toBe(true);
  });

  it('drops a cell stroke that has nothing left', () => {
    expect(eraseStrokes([line(cells)], [25, 5, 25, 5], 100, pixelTools, cutOf)).toEqual([]);
  });

  it('leaves cells the capsule only passes between', () => {
    // Dead centre of the gap between two cells, too small to cover either.
    const result = eraseStrokes([line([0, 0, 10, 0])], [10, 5, 10, 5], 4, pixelTools, cutOf);
    expect(result).toHaveLength(1);
    expect(result[0].points).toEqual([0, 0, 10, 0]);
  });

  /** A square contour: the ring the renderer closes and fills. */
  const square = () => line([0, 0, 100, 0, 100, 100, 0, 100], 0);

  it('cuts a contour across into two shapes, each closed on its own', () => {
    const pencil = line([200, 0, 300, 0], 1);

    const result = eraseStrokes([square(), pencil], [50, -50, 50, 150], 6, contourTools);

    const shapes = result.filter((piece) => piece.tool_id === 0);
    expect(shapes).toHaveLength(2);
    // Each piece is a shape in its own right, not an open leftover.
    for (const shape of shapes) {
      expect(shape.points.length).toBeGreaterThanOrEqual(6);
    }
    const xs = (piece: { points: number[] }) => piece.points.filter((_, i) => i % 2 === 0);
    expect(Math.max(...xs(shapes[0]))).toBeLessThanOrEqual(50);
    expect(Math.min(...xs(shapes[1]))).toBeGreaterThanOrEqual(50);
    // The pencil beside it is cut by its own rule, untouched here.
    expect(result).toContainEqual(pencil);
  });

  it('joins the pieces that meet at the start of the list', () => {
    // The first point is a point of the ring, not a corner of the shape: a cut
    // that leaves survivors on both sides of it must not make two of them.
    const result = eraseStrokes([square()], [-50, 50, 150, 50], 6, contourTools);

    expect(result).toHaveLength(2);
    expect(result.every((piece) => piece.points.length >= 6)).toBe(true);
  });

  it('leaves one dented shape when the capsule only bites an edge', () => {
    const result = eraseStrokes([square()], [50, 0, 50, 0], 6, contourTools);

    expect(result).toHaveLength(1);
    // The dent is two new points on the edge the capsule reached.
    expect(result[0].points).toHaveLength(square().points.length + 4);
  });

  it('bites a corner without splitting the shape', () => {
    const result = eraseStrokes([square()], [0, 0, 0, 0], 20, contourTools);

    expect(result).toHaveLength(1);
  });

  it('leaves a contour the capsule passed inside of', () => {
    // A hole is not a shape the format can hold: `contour` is one closed ring.
    expect(eraseStrokes([square()], [40, 50, 60, 50], 6, contourTools)).toEqual([square()]);
  });

  it('drops a contour the capsule swallowed', () => {
    expect(eraseStrokes([square()], [50, 50, 50, 50], 500, contourTools)).toEqual([]);
  });

  it('keeps a contour the capsule never reached', () => {
    expect(eraseStrokes([square()], [500, 500, 500, 500], 5, contourTools)).toEqual([square()]);
  });
});
