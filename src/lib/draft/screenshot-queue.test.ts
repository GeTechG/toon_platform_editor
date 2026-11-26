import { describe, expect, it } from 'bun:test';
import { createScreenshotQueue } from './screenshot-queue';

function harness(initialHidden = false) {
  let hidden = initialHidden;
  let idleCallbacks: Array<{ fn: () => void; cancelled: boolean }> = [];
  const rendered: Array<{ doc: string; resolve: (b: Blob) => void; reject: (e: unknown) => void }> = [];
  const saved: Array<{ id: string; text: string }> = [];
  const errors: unknown[] = [];

  const queue = createScreenshotQueue<string>({
    render: (doc) =>
      new Promise<Blob>((resolve, reject) => {
        rendered.push({ doc, resolve, reject });
      }),
    save: async (id, blob) => {
      saved.push({ id, text: await blob.text() });
    },
    isHidden: () => hidden,
    scheduleIdle: (run) => {
      const entry = { fn: run, cancelled: false };
      idleCallbacks.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    onError: (err) => errors.push(err),
  });

  const runNextIdle = () => {
    const active = idleCallbacks.filter((c) => !c.cancelled);
    idleCallbacks = [];
    for (const item of active) {
      item.fn();
    }
  };

  return {
    queue,
    setHidden: (v: boolean) => {
      hidden = v;
    },
    idleCount: () => idleCallbacks.filter((c) => !c.cancelled).length,
    cancelledCount: () => idleCallbacks.filter((c) => c.cancelled).length,
    runNextIdle,
    rendered,
    saved,
    errors,
  };
}

describe('createScreenshotQueue', () => {
  it('coalesces pending renders per draft ID so saving draft B never cancels draft A', async () => {
    const h = harness(false);
    h.queue.enqueue('draft-a', 'a-v1');
    h.queue.enqueue('draft-b', 'b-v1');
    h.queue.enqueue('draft-a', 'a-v2');
    expect(h.idleCount()).toBe(1);

    h.runNextIdle();
    expect(h.rendered.map((r) => r.doc)).toEqual(['a-v2']);
    h.rendered[0].resolve(new Blob(['shot:a-v2']));
    await new Promise((r) => setTimeout(r, 0));

    expect(h.rendered.map((r) => r.doc)).toEqual(['a-v2', 'b-v1']);
    h.rendered[1].resolve(new Blob(['shot:b-v1']));
    await new Promise((r) => setTimeout(r, 0));

    expect(h.saved).toEqual([
      { id: 'draft-a', text: 'shot:a-v2' },
      { id: 'draft-b', text: 'shot:b-v1' },
    ]);
  });

  it('cancels the idle timer on pause and defers hide-saves until resume when visible again', async () => {
    const h = harness(false);
    h.queue.enqueue('draft-a', 'a-v1');
    expect(h.idleCount()).toBe(1);

    // Tab hides: pending timer is cancelled, and hide-save records the newer doc as deferred.
    h.setHidden(true);
    h.queue.pause();
    expect(h.idleCount()).toBe(0);
    expect(h.cancelledCount()).toBe(1);

    h.queue.enqueue('draft-a', 'a-v2', true);
    expect(h.idleCount()).toBe(0);

    // Still hidden: resume is a no-op.
    h.queue.resume();
    expect(h.idleCount()).toBe(0);

    // Tab becomes visible again: resume schedules the deferred render.
    h.setHidden(false);
    h.queue.resume();
    expect(h.idleCount()).toBe(1);

    h.runNextIdle();
    expect(h.rendered.map((r) => r.doc)).toEqual(['a-v2']);
    h.rendered[0].resolve(new Blob(['shot:a-v2']));
    await new Promise((r) => setTimeout(r, 0));

    expect(h.saved).toEqual([{ id: 'draft-a', text: 'shot:a-v2' }]);
  });

  it('re-queues a draft if the tab hides mid-render and flushes immediately on flushNow when the hub opens', async () => {
    const h = harness(false);
    h.queue.enqueue('draft-a', 'a-v1');
    h.runNextIdle();
    expect(h.rendered.map((r) => r.doc)).toEqual(['a-v1']);

    // Tab hides before render resolves — must NOT call save while hidden, and must keep draft-a queued.
    h.setHidden(true);
    h.rendered[0].resolve(new Blob(['shot:a-v1']));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.saved).toEqual([]);

    // User returns and immediately opens the drafts hub before idle fires.
    h.setHidden(false);
    const flushing = h.queue.flushNow();
    expect(h.rendered.map((r) => r.doc)).toEqual(['a-v1', 'a-v1']);
    h.rendered[1].resolve(new Blob(['shot:a-v1-fresh']));
    await flushing;

    expect(h.saved).toEqual([{ id: 'draft-a', text: 'shot:a-v1-fresh' }]);
  });

  it('drops pending work and cancels timers on dispose', async () => {
    const h = harness(false);
    h.queue.enqueue('draft-a', 'a-v1');
    h.queue.dispose();
    expect(h.idleCount()).toBe(0);

    h.queue.resume();
    expect(h.idleCount()).toBe(0);

    await h.queue.flushNow();
    expect(h.rendered).toEqual([]);
    expect(h.saved).toEqual([]);
  });

  it('discards both queued and running screenshots of the specified draft', async () => {
    const h = harness();
    h.queue.enqueue('draft-a', 'a-v1');
    h.runNextIdle();
    h.queue.enqueue('draft-a', 'a-v2');
    h.queue.enqueue('draft-b', 'b-v1');

    h.queue.discard('draft-a');
    const flushing = h.queue.flushNow();
    h.rendered[0].resolve(new Blob(['shot:a-v1']));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.rendered.map((r) => r.doc)).toEqual(['a-v1', 'b-v1']);
    h.rendered[1].resolve(new Blob(['shot:b-v1']));
    await flushing;
    expect(h.saved).toEqual([{ id: 'draft-b', text: 'shot:b-v1' }]);
  });
});
