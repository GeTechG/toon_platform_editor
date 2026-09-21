import { describe, expect, test } from 'bun:test';

import { CANVAS_LOGICAL_WIDTH, FIXED_POINT_SCALE, STROKE_COORD_MAX } from '../format/constants';
import { editCells, makeHost } from './host';
import { pluginNamespace } from './contract';
import { i18n } from '../i18n';

const cells = () => [
  { strokes: [{ points: [0, 0, 10, 10], tool_id: 1 }] },
  { strokes: [{ points: [20, 20], tool_id: 2 }, { points: [30, 30], tool_id: 3 }] },
];

describe('the unit a plugin measures in', () => {
  test('the host offers no conversion: a unit is a fixed fraction of a pixel', () => {
    // There is nothing to ask about — `FIXED_POINT_SCALE` is a constant of
    // the contract and means the same on a document of any size — so the
    // host does not carry a method that would suggest otherwise.
    const host = makeHost({
      doc: { width: CANVAS_LOGICAL_WIDTH * FIXED_POINT_SCALE },
      pluginStrokes: () => [],
      editPluginCells: () => {},
      openPluginWindow: () => ({}) as HTMLElement,
    }, 'a.units');
    expect('referencePx' in host).toBe(false);
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

describe('the words a plugin is handed', () => {
  test('host.t reads the keys of the plugin that was handed the host', () => {
    i18n.addResourceBundle('ru', pluginNamespace('a.words'), { hello: 'Привет' });
    const host = makeHost({
      doc: { width: CANVAS_LOGICAL_WIDTH * FIXED_POINT_SCALE },
      pluginStrokes: () => [],
      editPluginCells: () => {},
      openPluginWindow: () => ({}) as HTMLElement,
    }, 'a.words');

    expect(host.t('hello')).toBe('Привет');
    // Someone else's keys, including the editor's, are not its to read.
    expect(host.t('tool.pencil.label')).toBe('tool.pencil.label');
  });
});
