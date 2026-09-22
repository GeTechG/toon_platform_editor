import { describe, expect, it } from 'bun:test';
import { BufferRing } from './buffer-ring';

describe('a fixed ring of buffers', () => {
  it('hands the same buffer back for a key it holds', () => {
    let made = 0;
    const ring = new BufferRing(3, () => ({ id: made++ }));

    const first = ring.take('a');
    expect(first.fresh).toBe(true);
    const again = ring.take('a');
    expect(again.buffer).toBe(first.buffer);
    expect(again.fresh).toBe(false);
    expect(made).toBe(1);
  });

  it('never makes more buffers than it has slots', () => {
    // The onion cache is keyed by the pan, so a pan misses on every frame of
    // the gesture. Missing must cost a redraw, not a full-screen canvas.
    let made = 0;
    const ring = new BufferRing(3, () => ({ id: made++ }));

    for (let i = 0; i < 500; i++) {
      expect(ring.take(`pan-${i}`).fresh).toBe(true);
    }
    expect(made).toBe(3);
  });

  it('reuses the slot of the key it saw longest ago', () => {
    let made = 0;
    const ring = new BufferRing(2, () => ({ id: made++ }));

    const a = ring.take('a').buffer;
    const b = ring.take('b').buffer;
    const c = ring.take('c');

    expect(c.buffer).toBe(a);
    expect(c.fresh).toBe(true);
    // 'b' was not touched by the eviction.
    expect(ring.take('b')).toEqual({ buffer: b, fresh: false });
    // 'a' has lost its slot and comes back as a buffer to draw into.
    expect(ring.take('a').fresh).toBe(true);
  });
});
