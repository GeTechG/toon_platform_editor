import { describe, expect, it } from 'bun:test';
import { waveformBars } from '../audio/track';
import { frameMenuTop } from './frame-selection';

// Thirteenth audit, the timeline. Svelte components are asserted as source, as
// in audit12-timeline.test.ts: the runes need the compiler to run.
const timeline = await Bun.file(new URL('./Timeline.svelte', import.meta.url)).text();
const style = timeline.slice(timeline.indexOf('<style'));

describe('thirteenth audit: the wave is not a comb', () => {
  it('a steady tone draws a steady wave when a frame has more bars than levels', () => {
    // The envelope keeps 200 levels a second; at 12 fps a 48 px cell asks for
    // 24 bars of a frame's 16.7 levels, and every third bar held none — a
    // constant tone drew as teeth down to the floor, at 24 fps two in three.
    const envelope = new Float32Array(200).fill(0.5);
    for (const fps of [12, 24]) {
      const bars = waveformBars(envelope, 200, fps, 24);
      expect(bars.length).toBe(fps * 24);
      expect(Math.min(...bars)).toBeCloseTo(1, 5);
    }
  });

  it('a bar between two levels takes the level it starts in', () => {
    const envelope = new Float32Array([1, 0.5]);
    // Two levels a second, one frame a second, four bars a frame.
    expect([...waveformBars(envelope, 2, 1, 4)]).toEqual([1, 1, 0.5, 0.5]);
  });

  it('a window with samples is still their mean', () => {
    const bars = waveformBars(new Float32Array([1, 0.5, 0.25, 0.25]), 4, 1, 2);
    expect(bars.length).toBe(2);
    expect(bars[0]).toBeCloseTo(1, 5);
    expect(bars[1]).toBeCloseTo(0.25 / 0.75, 5);
  });
});

describe('thirteenth audit: a hidden layer dims its drawing, not the rings', () => {
  it('the active ring and the focus ring keep their full red on a hidden row', () => {
    // `.cell.dim { opacity }` faded the whole button: the active ring and the
    // keyboard's outline on a hidden layer were red at 35 % — about 1.6:1 on
    // white, under the 3:1 a focus indicator needs (WCAG 1.4.11, 2.4.7).
    expect(style).not.toMatch(/\.cell\.dim \{[^}]*opacity/);
    expect(style).toMatch(/\.cell\.dim > :global\(canvas\) \{[^}]*opacity: 0\.35;/);
  });
});

describe('thirteenth audit: the frame menu does not cover its cell', () => {
  const view = 800;
  const h = 272;

  it('opens below the press when there is room', () => {
    expect(frameMenuTop({ y: 100, above: 100 }, h, view)).toBe(100);
  });

  it('opens above the press when the strip sits at the bottom', () => {
    // It used to be pushed up just far enough to fit — over the cell pressed,
    // hiding the frame it was about to act on.
    expect(frameMenuTop({ y: 680, above: 680 }, h, view)).toBe(680 - h);
  });

  it('from the keyboard it hangs under the cell, or sits on top of it', () => {
    expect(frameMenuTop({ y: 694, above: 666 }, h, view)).toBe(666 - h);
    expect(frameMenuTop({ y: 200, above: 172 }, h, view)).toBe(200);
  });

  it('a finger keeps its gap either way', () => {
    expect(frameMenuTop({ y: 680, above: 680 }, h, view, 16)).toBe(680 - h - 16);
    expect(frameMenuTop({ y: 100, above: 100 }, h, view, 16)).toBe(116);
  });

  it('with room on neither side it stays on screen', () => {
    expect(frameMenuTop({ y: 150, above: 150 }, h, 300)).toBe(24);
    expect(frameMenuTop({ y: 150, above: 150 }, 500, 300)).toBe(4);
  });

  it('the strip places its menu through it, the cell box for a key press', () => {
    const show = timeline.match(/function showMenu[\s\S]*?\n  }/)?.[0] ?? '';
    expect(show).toContain('frameMenuTop(');
    // Shift+F10 in Chrome: clientX/Y at the cell's middle, pointerType «mouse», button -1.
    expect(timeline).toMatch(/const keyed = e\.button !== 2 \|\|/);
  });
});
