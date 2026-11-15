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
  frames: number[];
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
 * The film as one worker needs it: every frame in its place, the strokes of
 * `frames` alone. Each worker holding all of a heavy toon was the film over
 * again per worker (2026-11-15).
 */
export function filmFor(doc: ToonDocument, frames: readonly number[]): ToonDocument {
  const own = new Set(frames);
  return {
    ...doc,
    layers: doc.layers.map((layer) => ({
      ...layer,
      frames: layer.frames.map((cell, index) => (own.has(index) ? cell : { strokes: [] })),
    })),
  };
}

/**
 * Starts the crew on `frames` of the film, dealt round. `onFrame` gets every
 * frame as it comes; `onEnd` is called
 * once, when no more will: `false` if a worker fell or ran out of memory, and
 * the caller draws what is missing itself. Returns the way to call it off.
 */
export function warmApart(
  doc: ToonDocument,
  crew: number,
  frames: readonly number[],
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
      const share = frames.filter((_, i) => i % crew === from);
      // A page holds the film in its state, and a Svelte `$state` is a proxy:
      // it does not clone into a worker, and the crew fell to the page every
      // time. The document is plain data, so a copy of it through JSON clones —
      // one worker's share at a time, not the whole film at once.
      const film = JSON.parse(JSON.stringify(filmFor(doc, share))) as ToonDocument;
      worker.postMessage({ doc: film, frames: share } satisfies WarmOrder);
    } catch (err) {
      // A film that cannot be handed over leaves no worker behind.
      stop();
      throw err;
    }
  }
  return stop;
}
