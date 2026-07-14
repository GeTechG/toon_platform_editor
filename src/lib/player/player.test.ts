import { describe, expect, it } from 'bun:test';
import { LoopPlayer } from './player';

function makePlayer(overrides: Partial<ConstructorParameters<typeof LoopPlayer>[0]> = {}) {
  const shown: number[] = [];
  const player = new LoopPlayer({
    frameCount: 3,
    fps: 10, // 100 ms interval — easy to reason about
    startFrame: 0,
    onFrame: (f) => shown.push(f),
    ...overrides,
  });
  return { player, shown };
}

describe('LoopPlayer', () => {
  it('advances frames in order, looping', () => {
    const { player, shown } = makePlayer();
    player.tick(0);
    player.tick(100);
    player.tick(200);
    player.tick(300);
    expect(shown).toEqual([1, 2, 0]);
  });

  it('does not advance before the interval accumulates', () => {
    const { player, shown } = makePlayer();
    player.tick(0);
    player.tick(50);
    player.tick(99);
    expect(shown).toEqual([]);
    expect(player.currentFrame).toBe(0);
  });

  it('accumulator: a large tick advances several frames without drift', () => {
    const { player, shown } = makePlayer();
    player.tick(0);
    player.tick(250); // 2 frames, 50 ms remainder
    expect(shown).toEqual([2]);
    player.tick(300); // 50 + 50 = exactly one interval
    expect(shown).toEqual([2, 0]);
  });

  it('fps sets the frame-change speed', () => {
    const { player, shown } = makePlayer({ fps: 24 });
    player.tick(0);
    player.tick(1000 / 24 + 0.001);
    expect(shown).toEqual([1]);
  });

  it('stop returns the frame playback started from', () => {
    const { player } = makePlayer({ startFrame: 1 });
    player.tick(0);
    player.tick(100);
    player.tick(200);
    expect(player.currentFrame).toBe(0); // 1 → 2 → 0
    expect(player.stop()).toBe(1);
  });

  it('a single-frame loop stays in place', () => {
    const { player, shown } = makePlayer({ frameCount: 1 });
    player.tick(0);
    player.tick(100);
    player.tick(200);
    expect(shown).toEqual([0, 0]);
    expect(player.currentFrame).toBe(0);
  });

  it('rejects invalid options', () => {
    expect(() => makePlayer({ frameCount: 0 })).toThrow(RangeError);
    expect(() => makePlayer({ fps: 0 })).toThrow(RangeError);
    expect(() => makePlayer({ startFrame: 3 })).toThrow(RangeError);
  });
});
