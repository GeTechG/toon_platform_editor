/**
 * The worker that rasterizes cells for the warmer, where the browser has one
 * that can draw (cell-warm.ts `warmWay`). Absent elsewhere: the page draws.
 */

import type { CellReply } from './cell-worker';
import { warmWay, type CellJob, type WarmCrew } from './cell-warm';

/** Whether an off-screen canvas gives a 2D context here (Safari before 16.4 did not). */
function offscreen2d(): boolean {
  try {
    return typeof OffscreenCanvas !== 'undefined' && new OffscreenCanvas(1, 1).getContext('2d') !== null;
  } catch {
    return false;
  }
}

/** A crew of one worker, or undefined where the cells are drawn on the page. */
export function cellCrew(): (WarmCrew & { close(): void }) | undefined {
  if (warmWay({ worker: typeof Worker !== 'undefined', offscreen2d: offscreen2d() }) !== 'workers') {
    return undefined;
  }
  let worker: Worker;
  try {
    worker = new Worker(new URL('./cell-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return undefined;
  }
  let nextId = 0;
  const waiting = new Map<number, (reply: CellReply | null) => void>();
  worker.onmessage = (e: MessageEvent<CellReply>) => {
    waiting.get(e.data.id)?.(e.data);
    waiting.delete(e.data.id);
  };
  // A worker that will not load or fell over: everything waiting gets nothing.
  worker.onerror = () => {
    for (const answer of waiting.values()) answer(null);
    waiting.clear();
  };
  return {
    draw(job: CellJob) {
      const id = nextId++;
      return new Promise((resolve) => {
        waiting.set(id, (reply) => {
          if (!reply || 'failed' in reply) {
            resolve(null);
            return;
          }
          const { bitmap } = reply;
          resolve({ image: bitmap, free: () => bitmap.close() });
        });
        // The document may be a Svelte proxy, which does not clone: plain data goes.
        const plain: CellJob = JSON.parse(JSON.stringify(job));
        worker.postMessage({ id, job: plain });
      });
    },
    close() {
      worker.terminate();
      for (const answer of waiting.values()) answer(null);
      waiting.clear();
    },
  };
}
