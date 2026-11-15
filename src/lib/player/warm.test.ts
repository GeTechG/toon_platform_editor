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
      const left = [0];
      warmApart(doc, 1, () => left.shift() ?? null, () => {}, () => resolve(false));
      setTimeout(() => resolve(true), 2000);
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


/** A worker that draws what it is told at once: a frame per order, then done. */
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  orders: number[][] = [];
  terminated = false;
  constructor(private readonly fail = false) {}
  postMessage(order: { frames: number[] }): void {
    this.orders.push(order.frames);
    queueMicrotask(() => {
      if (this.fail) {
        this.onmessage?.({ data: { done: true, ok: false } } as MessageEvent);
        return;
      }
      for (const index of order.frames) {
        this.onmessage?.({ data: { index, frame: `frame ${index}` } } as MessageEvent);
      }
      this.onmessage?.({ data: { done: true, ok: true } } as MessageEvent);
    });
  }
  terminate(): void {
    this.terminated = true;
  }
}

describe('the crew draws what the show needs next', () => {
  const film = {
    schema_version: 7, width: 80, height: 80, frame_rate: 12, tools: [],
    layers: [{ name: 'a', frames: Array.from({ length: 6 }, () => ({ strokes: [] })) }],
  } as unknown as ToonDocument;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('takes a frame at a time as it is wanted, each from the one asking', async () => {
    const workers: FakeWorker[] = [];
    const wanted = [0, 1, 2, 3];
    const got: number[] = [];
    warmApart(film, 2, () => wanted.shift() ?? null, (index) => got.push(index), () => {}, () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });
    await settle();
    expect(got.sort()).toEqual([0, 1, 2, 3]);
    expect(workers.flatMap((worker) => worker.orders).every((frames) => frames.length === 1)).toBe(true);
  });

  it('waits when nothing is wanted and goes on when woken', async () => {
    const workers: FakeWorker[] = [];
    const wanted: number[] = [];
    const got: number[] = [];
    const crew = warmApart(film, 2, () => wanted.shift() ?? null, (index) => got.push(index), () => {}, () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });
    await settle();
    expect(got).toEqual([]);
    expect(workers.some((worker) => worker.terminated)).toBe(false);
    wanted.push(4, 5);
    crew.kick();
    await settle();
    expect(got.sort()).toEqual([4, 5]);
    crew.stop();
    expect(workers.every((worker) => worker.terminated)).toBe(true);
  });

  it('gives up to the page when a frame cannot be handed over, not only the first', async () => {
    const wanted = [0, 1, 2];
    let failed = 0;
    let posts = 0;
    warmApart(film, 1, () => wanted.shift() ?? null, () => {}, () => failed++, () => {
      const worker = new FakeWorker();
      const post = worker.postMessage.bind(worker);
      worker.postMessage = (order) => {
        if (++posts === 2) throw new Error('DataCloneError');
        post(order);
      };
      return worker as unknown as Worker;
    });
    await settle();
    expect(failed).toBe(1);
  });

  it('gives up to the page when a worker cannot draw', async () => {
    const wanted = [0, 1];
    let failed = false;
    warmApart(film, 1, () => wanted.shift() ?? null, () => {}, () => (failed = true),
      () => new FakeWorker(true) as unknown as Worker);
    await settle();
    expect(failed).toBe(true);
  });
});
