import { describe, expect, it } from 'bun:test';
import { LoopPlayer } from './player';
import { t } from '../i18n';

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
    expect(source).toContain("t('play.play')");
    expect(source).toContain("t('play.pause')");
    expect(t('play.play')).toBe('Проиграть');
    expect(t('play.pause')).toBe('Пауза');
    expect(source).toContain('aria-label={playing');
  });

  it('keeps the tap floor, the focus ring and a reduced-motion alternative', () => {
    expect(source).toContain('min-width: 44px');
    expect(source).toContain('min-height: 44px');
    expect(source).toContain(':focus-visible');
    expect(source).toContain('@media (prefers-reduced-motion: reduce)');
  });
});

describe('the player is red like the studio', () => {
  const style = source.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? '';
  const key = style.match(/\.play-key\s*\{([^}]*)\}/)?.[1] ?? '';

  it('fills the play key with the accent, not electric', () => {
    // Since 2026-09-23 electric keeps to the drawing aids — onion-skin and the
    // first layer tag; fills and rings of the chrome are the one red accent.
    expect(key).toMatch(/background:\s*var\(--accent\b/);
    expect(style).not.toContain('--electric');
  });

  it('is a flat pill that presses, like the studio key', () => {
    expect(key).toContain('border-radius: var(--r-pill');
    expect(key).not.toContain('box-shadow');
    expect(style).toMatch(/\.play-key:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--accent\b/);
    expect(style).toMatch(/\.play-key:active\s*\{[^}]*scale\(0\.96\)/);
  });
});

describe('the player takes its colours from the table', () => {
  it('writes no bare colour literal', () => {
    const style = (source.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(style.replace(/var\([^()]*\)/g, '').match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
  });
});
