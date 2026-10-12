// The film rasterized off the page's thread, by a few workers at once. A frame
// is every stroke of every layer drawn in software where there is no video
// card, and a film of them on one thread was the whole wait: four workers took
// it down 3.3 times, and the page stays alive while they draw.

import type { ToonDocument } from '../format/types';

/** More than four gave little: every worker holds the film and its buffers. */
const CREW_MAX = 4;

/** How many workers rasterize a film of `frames` on a device of `cores`. */
export function warmCrew(cores: number | undefined, frames: number): number {
  return Math.max(1, Math.min(CREW_MAX, (cores ?? 1) - 1, frames));
}

/** What a worker is told: the film, and which frames of it are its own. */
export interface WarmOrder {
  doc: ToonDocument;
  /** Its first frame, and how far apart its frames are — the crew's size. */
  from: number;
  step: number;
}

/** What a worker answers: a frame, or that it is through — `ok` if with all of them. */
export type WarmReport = { index: number; frame: ImageData } | { done: true; ok: boolean };

/**
 * Whether the film can be rasterized off the thread here. Safari got a 2D
 * context on an off-screen canvas in 16.4; before it the page draws the film
 * itself, as it always did.
 */
export function canWarmApart(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

/**
 * Starts the crew. `onFrame` gets every frame as it comes; `onEnd` is called
 * once, when no more will: `false` if a worker fell or ran out of memory, and
 * the caller draws what is missing itself. Returns the way to call it off.
 */
export function warmApart(
  doc: ToonDocument,
  crew: number,
  onFrame: (index: number, frame: ImageData) => void,
  onEnd: (ok: boolean) => void,
): () => void {
  const workers: Worker[] = [];
  let left = crew;
  let whole = true;
  const stop = (): void => {
    for (const worker of workers) worker.terminate();
    workers.length = 0;
  };
  const through = (ok: boolean): void => {
    whole &&= ok;
    if (--left === 0) {
      stop();
      onEnd(whole);
    }
  };
  for (let from = 0; from < crew; from++) {
    const worker = new Worker(new URL('./warm-worker.ts', import.meta.url), { type: 'module' });
    workers.push(worker);
    worker.onmessage = (e: MessageEvent<WarmReport>) => {
      if ('done' in e.data) through(e.data.ok);
      else onFrame(e.data.index, e.data.frame);
    };
    worker.onerror = () => {
      worker.onmessage = null;
      worker.onerror = null;
      through(false);
    };
    try {
      worker.postMessage({ doc, from, step: crew } satisfies WarmOrder);
    } catch (err) {
      // A film that cannot be handed over leaves no worker behind.
      stop();
      throw err;
    }
  }
  return stop;
}
