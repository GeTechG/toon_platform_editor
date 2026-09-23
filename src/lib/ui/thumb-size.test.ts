import { describe, expect, it } from 'bun:test';
import { fitThumb, rowHeight, CELL_BOX, cellStamp } from './thumb-size';
import { mirrorCell } from '../model/operations';

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

describe('ninth audit: a cell thumbnail sees an edit that keeps the stroke count', () => {
  // H, a lasso move and a transform rewrite the points in place: same cell,
  // same count, so the timeline went on showing the drawing before the edit.
  const doc = () => ({
    width: 100,
    height: 100,
    tools: [{}],
    layers: [{ hidden: false, frames: [{ strokes: [{ points: [10, 10, 30, 40], tool_id: 0 }] }] }],
  });

  it('a mirrored cell stamps differently', () => {
    const d = doc() as never as Parameters<typeof mirrorCell>[0];
    const before = cellStamp(d.layers[0].frames[0]);
    mirrorCell(d, 0, 0, 'horizontal');
    expect(cellStamp(d.layers[0].frames[0])).not.toBe(before);
  });

  it('the same drawing stamps the same, so a restored copy is not redrawn for nothing', () => {
    expect(cellStamp(doc().layers[0].frames[0])).toBe(cellStamp(doc().layers[0].frames[0]));
  });

  it('a stroke of a different tool stamps differently', () => {
    const other = doc();
    other.layers[0].frames[0].strokes[0].tool_id = 1;
    expect(cellStamp(other.layers[0].frames[0])).not.toBe(cellStamp(doc().layers[0].frames[0]));
  });
});

describe('ninth audit: the timeline cell redraws by its stamp', () => {
  it('LayerThumb compares the stamp, not the cell and its count', async () => {
    const thumb = await Bun.file(new URL('./LayerThumb.svelte', import.meta.url)).text();
    expect(thumb).toContain('cellStamp(cell)');
    expect(thumb).not.toContain('paintedStrokes');
  });
});
