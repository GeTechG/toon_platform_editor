/**
 * Coalesces draft card thumbnail renders per draft ID and pauses idle work
 * while the tab is hidden, deferring refreshes until the tab becomes visible
 * again or the drafts hub flushes them explicitly.
 */
export interface ScreenshotQueueOptions<TDoc> {
  render: (doc: TDoc) => Promise<Blob>;
  save: (id: string, blob: Blob, doc: TDoc) => Promise<void>;
  isHidden: () => boolean;
  scheduleIdle: (run: () => void) => () => void;
  onError?: (err: unknown) => void;
}

export interface ScreenshotQueue<TDoc> {
  enqueue: (id: string, doc: TDoc, defer?: boolean) => void;
  discard: (id: string) => void;
  pause: () => void;
  resume: () => void;
  flushNow: () => Promise<void>;
  dispose: () => void;
}

export function createScreenshotQueue<TDoc>(options: ScreenshotQueueOptions<TDoc>): ScreenshotQueue<TDoc> {
  const { render, save, isHidden, scheduleIdle, onError } = options;
  const pending = new Map<string, TDoc>();
  let cancelIdle: (() => void) | null = null;
  let draining: Promise<void> | null = null;
  let active: string | undefined;
  let disposed = false;

  function cancelScheduled(): void {
    cancelIdle?.();
    cancelIdle = null;
  }

  function schedule(): void {
    if (disposed || isHidden() || pending.size === 0 || cancelIdle || draining) {
      return;
    }
    cancelIdle = scheduleIdle(() => {
      cancelIdle = null;
      if (disposed || isHidden()) {
        return;
      }
      void drain();
    });
  }

  function drain(): Promise<void> {
    if (draining) {
      return draining;
    }
    const task = (async () => {
      while (!disposed && !isHidden() && pending.size > 0) {
        const next = pending.entries().next().value as [string, TDoc] | undefined;
        if (!next) {
          break;
        }
        const [id, doc] = next;
        pending.delete(id);
        active = id;
        let blob: Blob;
        try {
          blob = await render(doc);
        } catch (err) {
          onError?.(err);
          continue;
        }
        if (disposed) {
          return;
        }
        if (active !== id) continue;
        if (isHidden()) {
          if (!pending.has(id)) {
            pending.set(id, doc);
          }
          return;
        }
        if (pending.has(id)) {
          continue;
        }
        try {
          await save(id, blob, doc);
        } catch (err) {
          onError?.(err);
        }
        if (disposed) {
          return;
        }
        if (active !== id) continue;
        if (isHidden()) {
          if (!pending.has(id)) {
            pending.set(id, doc);
          }
          return;
        }
      }
    })().finally(() => {
      active = undefined;
      draining = null;
      if (!disposed && !isHidden() && pending.size > 0) {
        schedule();
      }
    });
    draining = task;
    return task;
  }

  return {
    enqueue(id: string, doc: TDoc, defer = false): void {
      if (disposed) {
        return;
      }
      pending.set(id, doc);
      if (!defer && !isHidden()) {
        schedule();
      }
    },
    discard(id: string): void {
      pending.delete(id);
      if (active === id) active = undefined;
      if (pending.size === 0) cancelScheduled();
    },
    pause(): void {
      cancelScheduled();
    },
    resume(): void {
      schedule();
    },
    async flushNow(): Promise<void> {
      cancelScheduled();
      while (!disposed && !isHidden() && (draining || pending.size > 0)) {
        await drain();
      }
    },
    dispose(): void {
      disposed = true;
      cancelScheduled();
      pending.clear();
    },
  };
}
