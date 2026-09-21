import { describe, expect, it } from 'bun:test';

import {
  BRUSH_SIZES_LOGICAL,
  CANVAS_LOGICAL_WIDTH,
  DEFAULT_BRUSH_SIZE_LOGICAL,
  MAX_BRUSH_SIZE_LOGICAL,
} from './constants';

/**
 * Every brush measures on the one logical canvas, so the numbers taken from
 * an editor that drew on another one are that editor's, multiplied. The
 * factor is written out here rather than imported: if either side is edited
 * by hand, the two stop agreeing and this says so.
 */
describe('the numbers taken from Multator, on the editor canvas', () => {
  const scale = CANVAS_LOGICAL_WIDTH / 600;

  it('the row of dots is the reference row, rounded to whole pixels of ours', () => {
    expect(BRUSH_SIZES_LOGICAL).toEqual([2, 4, 6, 10, 20].map((v) => Math.round(v * scale)) as never);
  });

  it('the starting width is the reference 4', () => {
    expect(DEFAULT_BRUSH_SIZE_LOGICAL).toBe(Math.round(4 * scale));
  });

  it('the ceiling is the reference 300, which lands whole', () => {
    expect(MAX_BRUSH_SIZE_LOGICAL).toBe(300 * scale);
  });
});
