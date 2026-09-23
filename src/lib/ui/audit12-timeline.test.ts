import { describe, expect, it } from 'bun:test';
import { LoopPlayer } from '../player/player';

// Twelfth audit, the timeline. Svelte components are asserted as source, as
// in audit11-timeline.test.ts: the runes need the compiler to run.
const timeline = await Bun.file(new URL('./Timeline.svelte', import.meta.url)).text();
const play = await Bun.file(new URL('./PlayControls.svelte', import.meta.url)).text();
const style = timeline.slice(timeline.indexOf('<style'));

function fn(source: string, name: string): string {
  return source.match(new RegExp(`function ${name}[\\s\\S]*?\\n  }`))?.[0] ?? '';
}

describe('twelfth audit: four-digit frame numbers', () => {
  it('a number never grows wider than its cell', () => {
    // At 200 % text «1485» is 54 px over a 48 px cell, and a portrait
    // document's 28 px cell overflows at 100 %: the header read
    // «14851486148714881489». Past the cell's width the digits stop growing.
    expect(timeline).toMatch(/class="head"[^>]*style:--pitch="\{thumbWidth\}px"/);
    expect(style).toMatch(/\.num \{[^}]*font-size: min\(0\.74rem, calc\(var\(--pitch\) \* 0\.42\)\);/);
  });
});

describe('twelfth audit: the frame menu at 400 % zoom', () => {
  it('scrolls inside the screen rather than running off its bottom', () => {
    // Six 44 px items are 272 px; a 1280×800 window at 400 % is 200 px tall,
    // and «Слить» and «Выделить кадры» sat below the edge, out of reach.
    const menu = style.match(/\.frame-menu \{[^}]*\}/)?.[0] ?? '';
    expect(menu).toMatch(/max-height: calc\(100dvh - 8px\);/);
    expect(menu).toMatch(/overflow-y: auto;/);
  });
});

describe('twelfth audit: the active row on a phone', () => {
  it('is brought into view when the panel, not the strip, is what scrolls', () => {
    // On a phone the strip grows to its rows and the panel scrolls instead:
    // with three layers the active one (the bottom row) opened under the fold.
    const rowEffect = timeline.match(/Keep the active row in view[\s\S]*?\n  \}\);/)?.[0] ?? '';
    expect(rowEffect).toMatch(/strip\.scrollHeight <= strip\.clientHeight/);
    expect(rowEffect).toContain('revealInPanel(');
    // Not scrollIntoView: embedded in a page, it scrolled the host page too.
    expect(fn(timeline, 'revealInPanel')).toContain('document.body');
  });
});

describe('twelfth audit: a tied track and a skipped lap', () => {
  const lapsOf = (fps: number, times: number[], loopEnd = 1) => {
    const laps: boolean[] = [];
    const player = new LoopPlayer({
      frameCount: 4,
      fps,
      startFrame: 0,
      loopStart: 0,
      loopEnd,
      onFrame: (_frame, lapped) => laps.push(lapped),
    });
    for (const t of times) player.tick(t);
    return laps;
  };

  it('says it came round even when the frame it lands on is the one it left', () => {
    // A two-frame loop at 10 fps and a 200 ms hitch: two steps, back on the
    // same frame. «frame < last» saw no lap, and the track ran past the loop.
    expect(lapsOf(10, [0, 200])).toEqual([true]);
  });

  it('does not say so on a plain step', () => {
    expect(lapsOf(10, [0, 100])).toEqual([false]);
    expect(lapsOf(10, [0, 100, 200])).toEqual([false, true]);
  });

  it('the preview reseeks on the lap, not on the frame number going down', () => {
    expect(play).toMatch(/onFrame: \(frame, lap\)/);
    expect(fn(play, 'tick')).not.toContain('< lastFrame');
  });
});
