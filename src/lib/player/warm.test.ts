import { describe, expect, it } from 'bun:test';
import { filmFor, warmApart, warmCrew } from './warm';
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

describe('a worker is handed its own frames', () => {
  it('keeps the strokes of its frames and leaves the rest empty, in place', () => {
    const stroke = (x: number) => ({ points: [x, x], tool_id: 0 });
    const doc = {
      schema_version: 7, width: 80, height: 80, frame_rate: 12, tools: [], holds: [1, 2, 3],
      layers: [
        { hidden: false, frames: [{ strokes: [stroke(1)] }, { strokes: [stroke(2)] }, { strokes: [stroke(3)] }] },
        { hidden: true, name: 'b', frames: [{ strokes: [stroke(4)] }, { strokes: [] }, { strokes: [stroke(6)] }] },
      ],
    } as unknown as ToonDocument;
    const own = filmFor(doc, [0, 2]);
    expect(own.layers.map((l) => l.frames.map((f) => f.strokes.map((s) => s.points[0])))).toEqual([[[1], [], [3]], [[4], [], [6]]]);
    expect(own.layers[1].hidden).toBe(true);
    expect(own.layers[1].name).toBe('b');
    expect(own.holds).toEqual([1, 2, 3]);
    expect(own.width).toBe(80);
  });
});

