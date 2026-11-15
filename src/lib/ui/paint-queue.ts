/**
 * Paints that may wait — the timeline's thumbnails drawn whole — done a few
 * milliseconds at a time between frames instead of in the pass that asked.
 *
 * A heavy draft opened put about a hundred cells on screen, and each drew
 * every stroke of its cell with its pressure outline: 1.9 s in one pass, and
 * the canvas waited behind them (2026-11-15). Queued, the canvas goes to the
 * screen first and the strip fills in after it, the studio answering the hand
 * meanwhile.
 */

export interface PaintQueue {
  /** Paints `run` later. Asking again for the same owner replaces its paint and keeps its place. */
  ask(owner: object, run: () => void): void;
  /** Whether the owner's paint is still to come. */
  waiting(owner: object): boolean;
  /** Drops the owner's paint, if it has not run. */
  cancel(owner: object): void;
}

export interface PaintQueueOptions {
  /** Milliseconds of painting per slice; one paint always runs, however long. */
  budget?: number;
  now?: () => number;
  /** Runs the next slice — before the next frame where there is one. */
  later?: (run: () => void) => void;
}

const nextFrame = (run: () => void): void => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => run());
  } else {
    setTimeout(run, 0);
  }
};

export function makePaintQueue({
  budget = 8,
  now = () => performance.now(),
  later = nextFrame,
}: PaintQueueOptions = {}): PaintQueue {
  // A Map keeps the order things were first asked in, and a second ask only
  // swaps the paint.
  const paints = new Map<object, () => void>();
  let scheduled = false;

  const slice = (): void => {
    scheduled = false;
    const start = now();
    for (const [owner, run] of paints) {
      paints.delete(owner);
      try {
        run();
      } catch (err) {
        console.warn('thumbnail paint failed:', err);
      }
      if (now() - start >= budget) {
        break;
      }
    }
    if (paints.size > 0) {
      schedule();
    }
  };

  const schedule = (): void => {
    if (!scheduled) {
      scheduled = true;
      later(slice);
    }
  };

  return {
    ask(owner, run) {
      paints.set(owner, run);
      schedule();
    },
    waiting: (owner) => paints.has(owner),
    cancel(owner) {
      paints.delete(owner);
    },
  };
}

/** The one the studio's thumbnails share. */
export const thumbPaints = makePaintQueue();
