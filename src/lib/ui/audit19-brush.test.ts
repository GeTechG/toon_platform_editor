import { describe, expect, it } from 'bun:test';
import { positionOfSize, sizeAtPosition } from './size-scale';

// Nineteenth audit, the brush.
const panel = await Bun.file(new URL('./BrushPanel.svelte', import.meta.url)).text();

describe('бегунок толщины после отпускания стоит на своей толщине', () => {
  // The track is continuous and the size is whole: at the thin end one size
  // is a ninth of the track. The value is written to the input only when the
  // size changes, so a thumb let go between two sizes stayed where the hand
  // left it — at «1» it stood up to 65 positions away from where 1 is.
  it('между 1 и 2 помещается отрезок дорожки, где толщина не меняется', () => {
    expect(sizeAtPosition(60, 1, 500)).toBe(1);
    expect(positionOfSize(1, 1, 500)).toBe(0);
  });

  it('отпущенный бегунок возвращается на место толщины', () => {
    const log = panel.slice(panel.indexOf('{#if log}'), panel.indexOf('{:else}', panel.indexOf('{#if log}')));
    expect(log).toMatch(/onchange=\{\(e\) => \(e\.currentTarget\.value = String\(Math\.round\(positionOfSize\(value, min, max\)\)\)\)\}/);
  });
});
