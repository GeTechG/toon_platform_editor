import { describe, expect, it } from 'bun:test';

import type { LineToolDescriptor } from '../format/types';
import { plugins } from '.';
import { OLDSCHOOL_TWIN, oldschoolSwap } from './oldschool';

const PENCIL: LineToolDescriptor = { kind: 'pencil', dialect: 'multator', width: 64, color: '#ff0000' };
const ERASER: LineToolDescriptor = { kind: 'eraser', dialect: 'multator', width: 64 };

function commit(id: string, descriptor: LineToolDescriptor, points: readonly number[], coordinateScale = 1) {
  const stroke = plugins.tool(id)?.stroke?.commit;
  if (!stroke) throw new Error(`${id} commits nothing`);
  return stroke(points, descriptor, { coordinateScale });
}

describe('the oldschool pen is a brush', () => {
  it('fixes the Multator canvas, whatever preset holds it', () => {
    expect(plugins.tool('oldschool')?.stroke?.dialect).toBe('multator');
    expect(plugins.tool('oldschool-eraser')?.stroke?.dialect).toBe('multator');
  });

  it('is on no preset panel — the easter egg is its only door', () => {
    expect(plugins.tool('oldschool')?.key).toBe('');
  });

  it('commits the line it drew as a filled contour of the pencil colour', () => {
    const stroke = commit('oldschool', PENCIL, [0, 0, 800, 0]);
    expect(stroke.tool).toEqual({ kind: 'contour', dialect: 'multator', color: '#ff0000' });
    // capsule around the 100 px segment at half width 4 px: 10 points
    expect(stroke.points).toHaveLength(20);
    expect(stroke.points.every(Number.isInteger)).toBe(true);
  });

  it('commits the eraser as a contour-eraser', () => {
    expect(commit('oldschool-eraser', ERASER, [0, 0, 800, 0]).tool)
      .toEqual({ kind: 'contour-eraser', dialect: 'multator' });
  });

  it('has no twin for the feather — a contour carries no fill', () => {
    // The reference ignored its flag for the feather; here the protection is
    // structural: there is no oldschool feather for the egg to swap in.
    expect(Object.keys(OLDSCHOOL_TWIN)).toEqual(['pencil', 'eraser']);
    expect(plugins.tool('feather')?.stroke?.commit).toBeUndefined();
  });

  it('swaps the brush in hand for its twin, and back', () => {
    expect(oldschoolSwap('pencil', null)).toEqual({ take: 'oldschool', back: 'pencil' });
    expect(oldschoolSwap('eraser', null)).toEqual({ take: 'oldschool-eraser', back: 'eraser' });
    expect(oldschoolSwap('oldschool', 'pencil')).toEqual({ take: 'pencil', back: null });
  });

  it('gives the brush back even when the word’s own keys moved the hand', () => {
    // Typing o, l, d presses three tool keys on the way: `o` is the hand. The
    // way back is what was remembered, not whatever the last key selected.
    expect(oldschoolSwap('drag', 'eraser')).toEqual({ take: 'eraser', back: null });
    // A brush with no twin of its own (the feather) still opens the pen.
    expect(oldschoolSwap('feather', null)).toEqual({ take: 'oldschool', back: 'feather' });
  });

  it('measures its Lang tolerance on the reference canvas, not on the document', () => {
    // A zigzag shallow enough that the coarser tolerance flattens it away.
    const zigzag = [0, 0, 200, 60, 400, 0, 600, 60, 800, 0];
    const near = commit('oldschool', PENCIL, zigzag, 1).points.length;
    const far = commit('oldschool', PENCIL, zigzag, 0.25).points.length;
    expect(far).toBeLessThan(near);
  });
});
