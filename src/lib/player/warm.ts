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

/** The crew at work: woken when frames are wanted again, let go with the film. */
export interface Crew {
  /** Idle workers ask again what is wanted: the show moved on and the window with it. */
  kick(): void;
  stop(): void;
}

const spawnWorker = (): Worker => new Worker(new URL('./warm-worker.ts', import.meta.url), { type: 'module' });

/**
 * Starts a crew of `crew` workers on the film. A worker free to draw asks
 * `pick` for the frame wanted next and gets it alone — not a share dealt out
 * up front: the show goes on while they draw, and what is wanted moves with
 * it (owner, 2026-11-16: a window of frames ahead, not the whole film). A
 * worker told nothing waits for `kick`. `onFrame` gets every frame as it
 * comes; `onFail` is called once if a worker falls or runs out of memory —
 * the crew is let go and the caller draws the rest itself.
 */
export function warmApart(
  doc: ToonDocument,
  crew: number,
  pick: () => number | null,
  onFrame: (index: number, frame: ImageData) => void,
  onFail: () => void,
  spawn: () => Worker = spawnWorker,
): Crew {
  const workers: Worker[] = [];
  const idle: Worker[] = [];
  let over = false;
  const stop = (): void => {
    over = true;
    for (const worker of workers) worker.terminate();
    workers.length = 0;
    idle.length = 0;
  };
  // Told a turn later: a crew that fails while it is being started has not
  // been handed to its caller yet.
  const fail = (): void => {
    if (over) return;
    stop();
    queueMicrotask(onFail);
  };
  const give = (worker: Worker): void => {
    if (over) return;
    const index = pick();
    if (index === null) {
      idle.push(worker);
      return;
    }
    try {
      // A page holds the film in its state, and a Svelte `$state` is a proxy:
      // it does not clone into a worker, and the crew fell to the page every
      // time. The document is plain data, so a copy of it through JSON clones —
      // the strokes of the one frame only.
      const film = JSON.parse(JSON.stringify(filmFor(doc, [index]))) as ToonDocument;
      worker.postMessage({ doc: film, frames: [index] } satisfies WarmOrder);
    } catch {
      // A frame that cannot be handed over, now or later: the page draws the
      // rest, the frame asked for included.
      fail();
    }
  };
  for (let n = 0; n < crew; n++) {
    const worker = spawn();
    workers.push(worker);
    worker.onmessage = (e: MessageEvent<WarmReport>) => {
      if (over) return;
      if (!('done' in e.data)) onFrame(e.data.index, e.data.frame);
      else if (e.data.ok) give(worker);
      else fail();
    };
    worker.onerror = () => fail();
  }
  for (const worker of [...workers]) give(worker);
  return {
    kick() {
      for (const worker of idle.splice(0)) give(worker);
    },
    stop,
  };
}
