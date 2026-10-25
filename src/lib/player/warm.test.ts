import { describe, expect, it } from 'bun:test';
import { warmApart, warmCrew } from './warm';
import type { ToonDocument } from '../format/types';

describe('how many workers rasterize a film', () => {
  it('leaves a core to the page and stops at four', () => {
    expect(warmCrew(8, 500)).toBe(4);
    expect(warmCrew(4, 500)).toBe(3);
    expect(warmCrew(2, 500)).toBe(1);
  });

  it('is one where the device does not say how many cores it has', () => {
    expect(warmCrew(undefined, 500)).toBe(1);
    expect(warmCrew(1, 500)).toBe(1);
  });

  it('is never more than there are frames', () => {
    expect(warmCrew(8, 2)).toBe(2);
  });
});

describe('handing a film to the crew', () => {
  it('takes a film handed over reactive, as a page holds it in its state', async () => {
    // A Svelte `$state` is a proxy, and a proxy does not clone into a worker.
    const doc = new Proxy(
      { schema_version: 7, width: 80, height: 80, frame_rate: 12, tools: [], layers: [{ name: 'a', frames: [{ strokes: [] }] }] },
      {},
    ) as unknown as ToonDocument;
    const ended = await new Promise<boolean>((resolve) => {
      warmApart(doc, 1, [0], () => {}, resolve);
    });
    // Here the worker has no canvas to draw on and says so: the order reached it.
    expect(typeof ended).toBe('boolean');
  });
});
