import { describe, expect, it } from 'bun:test';
import { filmTiming } from '../model/timing';
import { fitZoom, numberEvery, zoomAnchor, scrollToFrame, stripLevel, stripWindow, wheelOnStrip, zoomBy, zoomScroll } from './strip-window';

const CELL = 46;
const GAP = 2;
const PITCH = CELL + GAP;

/**
 * What the row measures once the window is laid out: the spacers, the cells
 * built, and a gap between every pair of neighbours. It has to come out the
 * same as the row with every cell in it, or the strip slides under the hand.
 */
function laidOut(total: number, scrollLeft: number, viewWidth: number): number {
  const w = stripWindow(total, CELL, GAP, scrollLeft, viewWidth);
  const items: number[] = [];
  if (w.before > 0) items.push(w.before);
  for (let i = 0; i < w.count; i++) items.push(CELL);
  if (w.after > 0) items.push(w.after);
  if (items.length === 0) return 0;
  return items.reduce((a, b) => a + b, 0) + (items.length - 1) * GAP;
}

/** The row with nothing left out. */
const whole = (total: number): number => (total === 0 ? 0 : total * PITCH - GAP);

describe('the window of frames the strip builds', () => {
  it('builds everything when everything fits', () => {
    expect(stripWindow(10, CELL, GAP, 0, 1000)).toEqual({ first: 0, count: 10, before: 0, after: 0 });
  });

  it('builds the frames in view plus a screen either side', () => {
    // Twenty cells fit in the view; scrolled to frame 100, the window covers
    // frames 80..140 — the view and a screen of margin on each side.
    const view = 20 * PITCH;
    const w = stripWindow(300, CELL, GAP, 100 * PITCH, view);
    expect(w.first).toBe(80);
    expect(w.first + w.count).toBe(140);
  });

  it('stops the window at the ends of the document', () => {
    const view = 20 * PITCH;
    const head = stripWindow(300, CELL, GAP, 0, view);
    expect(head.first).toBe(0);
    expect(head.before).toBe(0);

    const tail = stripWindow(300, CELL, GAP, 280 * PITCH, view);
    expect(tail.first + tail.count).toBe(300);
    expect(tail.after).toBe(0);
  });

  it('keeps the row exactly as wide as it would be with every cell in it', () => {
    const view = 20 * PITCH;
    for (const total of [0, 1, 5, 41, 300, 4096]) {
      for (const at of [0, 1, 7, 100, 299, 4095]) {
        const scroll = Math.max(0, Math.min(at, total - 1)) * PITCH;
        expect(laidOut(total, scroll, view)).toBe(whole(total));
      }
    }
  });

  it('builds nothing for a document without frames', () => {
    expect(stripWindow(0, CELL, GAP, 0, 500)).toEqual({ first: 0, count: 0, before: 0, after: 0 });
  });

  it('builds everything when the cell has no width to measure by', () => {
    // Before the first layout the strip has no size; showing an empty strip
    // then is worse than building it whole for one frame.
    expect(stripWindow(30, 0, GAP, 0, 0)).toEqual({ first: 0, count: 30, before: 0, after: 0 });
    expect(stripWindow(30, CELL, GAP, 0, 0)).toEqual({ first: 0, count: 30, before: 0, after: 0 });
  });
});

describe('where the strip scrolls to show a frame', () => {
  const view = 20 * PITCH;
  const at = (frame: number, scrollLeft: number) =>
    scrollToFrame(frame, CELL, GAP, scrollLeft, view);

  it('leaves the scroll alone when the frame is already in view', () => {
    expect(at(15, 10 * PITCH)).toBeNull();
  });

  it('scrolls the least it can to bring a frame past the right edge into view', () => {
    // Frame 40 is well past the right edge of a view showing 10..29.
    expect(at(40, 10 * PITCH)).toBe(40 * PITCH + CELL - view);
  });

  it('scrolls to the frame itself when it is past the left edge', () => {
    expect(at(3, 10 * PITCH)).toBe(3 * PITCH);
  });

  it('says nothing before the strip has been laid out', () => {
    expect(scrollToFrame(5, CELL, GAP, 0, 0)).toBeNull();
  });
});

describe('tenth audit: the strip padding counts', () => {
  // The row starts 2px in (its padding), so frame N sits at 2 + N × pitch.
  // Scrolling to N × pitch + width left the last frame 2px under the edge:
  // its active ring and focus ring were cut off.
  const PAD = 2;
  const view = 20 * PITCH;

  it('brings the right edge in with the padding after it', () => {
    expect(scrollToFrame(40, CELL, GAP, 10 * PITCH, view, PAD)).toBe(PAD + 40 * PITCH + CELL + PAD - view);
  });

  it('brings the left edge in with the padding before it', () => {
    expect(scrollToFrame(3, CELL, GAP, 10 * PITCH, view, PAD)).toBe(3 * PITCH);
  });

  it('a frame already clear of both edges stays put', () => {
    expect(scrollToFrame(15, CELL, GAP, 10 * PITCH, view, PAD)).toBeNull();
  });
});

// Owner, 2026-10-18: the wheel over the frames scrolls the frames, not the page.
describe('where a wheel over the timeline scrolls the strip', () => {
  const wheel = (deltaX: number, deltaY: number, more: { deltaMode?: number; shiftKey?: boolean } = {}) =>
    ({ deltaX, deltaY, deltaMode: 0, shiftKey: false, ...more });

  it('one layer: the plain wheel walks the frames sideways', () => {
    expect(wheelOnStrip(wheel(0, 100), false, 300)).toEqual({ x: 100, y: 0 });
  });

  it('rows to scroll through: the plain wheel scrolls them, Shift walks the frames', () => {
    expect(wheelOnStrip(wheel(0, 100), true, 300)).toEqual({ x: 0, y: 100 });
    expect(wheelOnStrip(wheel(0, 100, { shiftKey: true }), true, 300)).toEqual({ x: 100, y: 0 });
  });

  it('a trackpad goes both ways as it moved', () => {
    expect(wheelOnStrip(wheel(30, -20), true, 300)).toEqual({ x: 30, y: -20 });
    expect(wheelOnStrip(wheel(30, -20), false, 300)).toEqual({ x: 30, y: -20 });
  });

  it('a wheel counted in lines or pages is turned into pixels', () => {
    expect(wheelOnStrip(wheel(0, 3, { deltaMode: 1 }), false, 300)).toEqual({ x: 48, y: 0 });
    expect(wheelOnStrip(wheel(0, 1, { deltaMode: 2 }), false, 300)).toEqual({ x: 300, y: 0 });
  });
});

describe('лента с длительностями кадров', () => {
  // Ячейка 40 + зазор 2: такт — 42 px. Кадры по 1, 5, 1, 1 тактов.
  const timing = filmTiming([1, 5, 1, 1], 4);

  it('кадр начинается после тактов предыдущих', () => {
    // Окно на всю ленту, промежутков нет.
    expect(stripWindow(4, 40, 2, 0, 1000, timing)).toEqual({ first: 0, count: 4, before: 0, after: 0 });
    // Узкое окно (190–220 px с полями) внутри длинного кадра 1 (такты 1–5, 42–250 px).
    expect(stripWindow(4, 40, 2, 200, 10, timing)).toEqual({ first: 1, count: 1, before: 40, after: 2 * 42 - 2 });
  });

  it('прокрутка к кадру считает его место и ширину в тактах', () => {
    // Кадр 2 стоит на такте 6: 252 px, шириной в одну ячейку.
    expect(scrollToFrame(2, 40, 2, 0, 100, 0, timing)).toBe(252 + 40 - 100);
    // Кадр 1 шириной 5 тактов: 5·42 − 2 = 208.
    expect(scrollToFrame(1, 40, 2, 0, 100, 0, timing)).toBe(42 + 208 - 100);
  });
});

describe('the strip\'s zoom', () => {
  it('keeps the tick under the pointer where it was', () => {
    // Tick 30 (from 0) under the pointer 100 px into a strip scrolled to 500, 20 px a tick.
    const pitch = 20;
    const x = 30 * pitch + 2 - 500 + 5;
    const left = zoomScroll(500, x, 2, pitch, 40);
    expect(Math.floor((left + x - 2) / 40)).toBe(30);
    expect((left + x - 2) / 40).toBeCloseTo((500 + x - 2) / 20, 6);
  });

  it('never scrolls before the start', () => {
    expect(zoomScroll(0, 10, 2, 20, 4)).toBe(0);
  });

  it('a wheel notch widens the cells by a step, held to 1–96 px', () => {
    expect(zoomBy(40, -100)).toBeGreaterThan(40);
    expect(zoomBy(40, 100)).toBeLessThan(40);
    expect(zoomBy(95, -1000)).toBe(96);
    expect(zoomBy(2, 1000)).toBe(1);
  });

  it('shows thumbnails from 40 px, marks from 14, bands below', () => {
    expect(stripLevel(40)).toBe('thumbs');
    expect(stripLevel(39)).toBe('marks');
    expect(stripLevel(14)).toBe('marks');
    expect(stripLevel(13)).toBe('bands');
  });

  it('thins the frame numbers so they never overlap: every fifth, then every tenth', () => {
    expect(numberEvery(48)).toBe(1);
    expect(numberEvery(12)).toBe(5);
    expect(numberEvery(4)).toBe(10);
    expect(numberEvery(2)).toBe(50);
  });
});

describe('fitZoom — «Весь фильм» (strip-zoom-keys)', () => {
  // The row: 2 px before the first cell, then a pitch a tick, then room for the end mark.
  it('narrows a long film into the strip, without gaps once a cell is under 14 px', () => {
    // 600 px of strip, 60 ticks, 16 px for the bracket: 582 / 60 = 9.7.
    expect(fitZoom(600, 60, 16)).toBeCloseTo(9.7, 2);
  });

  it('keeps the gap between cells wide enough to have one', () => {
    // 982 / 20 = 49.1 a tick, less the 2 px gap.
    expect(fitZoom(1000, 20, 16)).toBeCloseTo(47.1, 2);
  });

  it('stays under the gap threshold where a cell would get a gap it has no room for', () => {
    // 15 px a tick: a 15 px cell has a gap and overflows, a 13 px one with a gap is short — under 14, gapless.
    const w = fitZoom(60 * 15 + 2 + 16, 60, 16);
    expect(w).toBeLessThan(14);
    expect(w).toBeGreaterThan(13.9);
  });

  it('fits a 441-tick film into a desktop strip — under the old 4 px floor (owner, 2026-11-17)', () => {
    // 1160 px less 2 before and 180 for the end mark and the zoom group: 978 / 441 ≈ 2.21.
    expect(fitZoom(1160, 441, 180)).toBeCloseTo(2.21, 2);
  });

  it('is held to the range at either end', () => {
    expect(fitZoom(600, 2000, 16)).toBe(1);
    expect(fitZoom(1400, 1, 16)).toBe(96);
  });
});

describe('zoomAnchor — the point a key zooms about (strip-zoom-keys)', () => {
  it('is the current frame when it is in view', () => {
    // Frame from 300 to 346 px of row, strip scrolled 200 and 500 wide: its middle at 123 px of the box.
    expect(zoomAnchor(200, 500, 300, 46)).toBe(123);
  });

  it('is the middle of the strip when the current frame is scrolled away', () => {
    expect(zoomAnchor(2000, 500, 300, 46)).toBe(250);
  });
});
