import { describe, expect, it } from 'bun:test';
import { fitThumb, rowHeight, CELL_BOX } from './thumb-size';

describe('the canvas is max-fitted into the frame', () => {
  it('a square canvas fills a square box', () => {
    expect(fitThumb(600, 600, 32)).toEqual({ w: 32, h: 32 });
  });

  it('a wide canvas takes the whole width of the box and keeps its proportions', () => {
    expect(fitThumb(1920, 1080, 46, 46)).toEqual({ w: 46, h: 26 });
  });

  it('a tall canvas takes the whole height of the box', () => {
    expect(fitThumb(1080, 1920, 46, 46)).toEqual({ w: 26, h: 46 });
  });

  it('a box wider than it is tall caps both sides', () => {
    expect(fitThumb(1000, 1000, 60, 30)).toEqual({ w: 30, h: 30 });
  });

  it('an extreme ratio still has a pixel to draw on', () => {
    expect(fitThumb(4000, 10, 32)).toEqual({ w: 32, h: 1 });
  });
});

describe('the layer row follows the frame, down to the floor its name and icons need', () => {
  it('a short frame pulls the row down with it', () => {
    // 4:3 into a 46x46 frame: 46x35 of canvas, 41 of row.
    expect(rowHeight({ width: 4000, height: 3000 })).toBe(41);
  });

  it('a panoramic frame stops at the floor the name and the icons need', () => {
    expect(rowHeight({ width: 3000, height: 1000 })).toBe(32);
  });

  it('a tall frame pushes the row taller instead of being clipped', () => {
    expect(rowHeight({ width: 1080, height: 1920 })).toBe(CELL_BOX.h + 6);
  });
});
