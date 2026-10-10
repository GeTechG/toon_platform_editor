import { describe, expect, it } from 'bun:test';
import { plateAt } from './pop-place';

const view = { w: 1440, h: 900 };

describe('where a key’s window opens', () => {
  it('under its key, right edges flush — over it where the key is nearer the bottom', () => {
    expect(plateAt({ left: 1380, right: 1424, top: 64, bottom: 108 }, { w: 336, h: 600 }, view)).toEqual({ x: 1088, top: 114, max: 778 });
    expect(plateAt({ left: 400, right: 444, top: 800, bottom: 844 }, { w: 225, h: 400 }, view)).toEqual({ x: 219, bottom: 106, max: 786 });
  });

  it('beside a standing column, not over the keys of it: level with its key, kept inside the window', () => {
    // toonop on a desk: the brush's window stood over the tools it was opened from.
    const column = { left: 10, right: 73 };
    expect(plateAt({ left: 19, right: 63, top: 194, bottom: 238 }, { w: 225, h: 440 }, view, column)).toEqual({ x: 79, top: 194, max: 692 });
    // A key low in the column: the window is lifted to stay whole.
    expect(plateAt({ left: 19, right: 63, top: 640, bottom: 684 }, { w: 225, h: 440 }, view, column)).toEqual({ x: 79, top: 452, max: 434 });
    // A column at the far edge: the window opens towards the sheet.
    expect(plateAt({ left: 1377, right: 1421, top: 194, bottom: 238 }, { w: 225, h: 440 }, view, { left: 1367, right: 1430 }).x).toBe(1136);
  });
});
