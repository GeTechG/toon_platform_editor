import { describe, expect, it } from 'bun:test';
import { scrollToFrame, stripWindow } from './strip-window';

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
