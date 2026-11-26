import { expect, it } from 'bun:test';
import { bindContour, createGrid, warpContour } from './mesh';

it('subdivides a contour where it crosses the diagonal between two mesh triangles', () => {
  const grid = createGrid(1, 1);
  const contour = bindContour(grid, [0.2, 0.7, 0.8, 0.3, 0.8, 0.8]);
  // Stretch only the bottom-right vertex. The two triangles deform differently.
  const vertices = new Float32Array([0, 0, 1, 0, 0, 1, 1.5, 1]);
  const points = warpContour(contour, vertices);
  expect(points[0]).toBeCloseTo(0.3);
  expect(points[1]).toBeCloseTo(0.7);
  expect(points[2]).toBeCloseTo(0.75);
  expect(points[3]).toBeCloseTo(0.5);
  expect(points[4]).toBeCloseTo(0.95);
  expect(points[5]).toBeCloseTo(0.3);
});

it('preserves a contour in the rest pose after inserting crossings between cells', () => {
  const grid = createGrid(2, 2);
  const contour = bindContour(grid, [0, 0, 0.9, 0.1, 0.8, 0.8]);
  const points = warpContour(contour, grid.rest);
  expect(points[2]).toBeCloseTo(0.5);
  expect(points[3]).toBeCloseTo(0.5 / 9);
  for (const [index, point] of points.entries()) {
    expect(point).toBeCloseTo(contour.rest[index], 6);
  }
});
