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

describe('LoopPlayer over a frame range', () => {
  it('loops inside the range instead of over the whole document', () => {
    const { player, shown } = makePlayer({
      frameCount: 9,
      startFrame: 4,
      loopStart: 4,
      loopEnd: 6,
    });
    player.tick(0);
    player.tick(100);
    player.tick(200);
    player.tick(300);
    expect(shown).toEqual([5, 6, 4]);
  });

  it('starts mid-range (Shift+Space) and still comes back to the range start', () => {
    const { player, shown } = makePlayer({
      frameCount: 9,
      startFrame: 5,
      loopStart: 4,
      loopEnd: 6,
    });
    player.tick(0);
    player.tick(100);
    player.tick(200);
    expect(shown).toEqual([6, 4]);
  });

  it('a one-frame range stays in place', () => {
    const { player, shown } = makePlayer({ frameCount: 5, startFrame: 2, loopStart: 2, loopEnd: 2 });
    player.tick(0);
    player.tick(100);
    expect(shown).toEqual([2]);
  });

  it('rejects a range that does not hold the start frame or runs backwards', () => {
    expect(() => makePlayer({ frameCount: 9, startFrame: 0, loopStart: 4, loopEnd: 6 })).toThrow(RangeError);
    expect(() => makePlayer({ frameCount: 9, startFrame: 5, loopStart: 6, loopEnd: 4 })).toThrow(RangeError);
    expect(() => makePlayer({ frameCount: 3, startFrame: 0, loopStart: 0, loopEnd: 9 })).toThrow(RangeError);
  });
});
