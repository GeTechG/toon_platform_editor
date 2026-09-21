import { describe, expect, test } from 'bun:test';

import { CANVAS_LOGICAL_WIDTH, FIXED_POINT_SCALE, STROKE_COORD_MAX } from '../format/constants';
import { editCells, makeHost } from './host';

const cells = () => [
  { strokes: [{ points: [0, 0, 10, 10], tool_id: 1 }] },
  { strokes: [{ points: [20, 20], tool_id: 2 }, { points: [30, 30], tool_id: 3 }] },
];

describe('the unit a plugin measures in', () => {
  const host = (logicalWidth: number) => makeHost({
    doc: { width: logicalWidth * FIXED_POINT_SCALE },
    pluginStrokes: () => [],
    editPluginCells: () => {},
    openPluginWindow: () => ({}) as HTMLElement,
  });

  test('document units become pixels of the one logical canvas', () => {
    // A document of the logical canvas: one unit is 1/8 of a pixel.
    expect(host(CANVAS_LOGICAL_WIDTH).referencePx(8)).toBe(1);
    // Half as wide a document: the same picture, so a unit is worth double.
    expect(host(CANVAS_LOGICAL_WIDTH / 2).referencePx(8)).toBe(2);
  });
});

describe('editCells', () => {
  test('the plugin sees every stroke of every cell, in cell order', () => {
    const seen: number[] = [];

    editCells(cells(), (strokes) => strokes.forEach((stroke) => seen.push(stroke.tool_id as number)));

    expect(seen).toEqual([1, 2, 3]);
  });

  test('what the plugin wrote goes back into the cell it came from', () => {
    const next = editCells(cells(), (strokes) => {
      for (const stroke of strokes) {
        stroke.points = stroke.points.map((value) => value + 1);
      }
    });

    expect(next[0][0].points).toEqual([1, 1, 11, 11]);
    expect(next[1][1].points).toEqual([31, 31]);
    expect(next[1][1].tool_id).toBe(3);
  });

  test('the strokes handed over are copies: the cells are untouched until the write-back', () => {
    const before = cells();

    editCells(before, (strokes) => {
      strokes[0].points[0] = 999;
    });

    expect(before[0].strokes[0].points[0]).toBe(0);
  });

  test('a coordinate outside the document is clamped, whatever the plugin wrote', () => {
    const next = editCells(cells(), (strokes) => {
      strokes[0].points = [Number.POSITIVE_INFINITY, -1e12];
    });

    expect(next[0][0].points[0]).toBe(STROKE_COORD_MAX);
    expect(Number.isFinite(next[0][0].points[1])).toBe(true);
  });

  test('a fresh stroke object every time, so the canvas knows its buffers are stale', () => {
    const before = cells();

    const next = editCells(before, () => {});

    expect(next[0][0]).not.toBe(before[0].strokes[0]);
    expect(next[0][0].points).toEqual(before[0].strokes[0].points);
  });

  test('adding or dropping strokes is not part of the contract: the cells keep their own', () => {
    const next = editCells(cells(), (strokes) => {
      strokes.push({ points: [1, 1], tool_id: 9 });
      strokes.shift();
    });

    expect(next[0]).toHaveLength(1);
    expect(next[1]).toHaveLength(2);
  });
});
