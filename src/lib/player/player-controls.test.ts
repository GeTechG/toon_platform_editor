import { describe, expect, it } from 'bun:test';
import { LoopPlayer } from './player';

// Player.svelte is a runes component, so its contract is asserted as source
// (same style as the ui/ component tests); the LoopPlayer behaviour that
// pause/resume leans on is exercised for real.
const source = await Bun.file(new URL('./Player.svelte', import.meta.url)).text();

describe('pause and resume', () => {
  it('a player restarted at the frame on screen carries on from it', () => {
    // Pausing drops the loop; pressing play builds a new one whose
    // startFrame is whatever is on the canvas, so nothing jumps or skips.
    const seen: number[] = [];
    const resumed = new LoopPlayer({
      frameCount: 4,
      fps: 10,
      startFrame: 2,
      onFrame: (frame) => seen.push(frame),
    });
    resumed.tick(5000); // the first tick only primes the clock
    resumed.tick(5100);
    resumed.tick(5200);

    expect(seen).toEqual([3, 0]);
  });
});

describe('Player controls contract', () => {
  it('takes an optional controls flag and a bindable playing state', () => {
    expect(source).toContain('controls');
    expect(source).toContain('playing = $bindable(');
  });

  it('does not autoplay under reduced motion', () => {
    expect(source).toContain('(prefers-reduced-motion: reduce)');
    expect(source).toMatch(/playing = \$bindable\(!\s*prefersReducedMotion\(\)\)/);
  });

  it('runs the frame clock only while playing', () => {
    const loop = source.match(/\$effect\(\(\) => \{[^]*?requestAnimationFrame[^]*?\n  \}\);/)?.[0] ?? '';
    expect(loop).toContain('if (!playing)');
    expect(loop).toContain('cancelAnimationFrame');
  });

  it('names the button in Russian and gives it a real accessible name', () => {
    expect(source).toContain('Проиграть');
    expect(source).toContain('Пауза');
    expect(source).toContain('aria-label={playing');
  });

  it('keeps the tap floor, the focus ring and a reduced-motion alternative', () => {
    expect(source).toContain('min-width: 44px');
    expect(source).toContain('min-height: 44px');
    expect(source).toContain(':focus-visible');
    expect(source).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
