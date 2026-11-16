/**
 * The cells of the neighbouring frames, rasterized while the studio idles.
 *
 * With the cell cache a frame already visited costs blits; one not visited yet
 * costs every line of it — 1.5 s for five steps forward through a heavy
 * drawing on a weak processor (a sent file, 2026-11-14). The frames around the
 * one on screen are the ones the hand goes to next, so their cells go into the
 * cache before it does: in a worker where the browser can draw in one, or else
 * on the page, a cell per idle moment (owner, 2026-11-14: do more where the
 * browser can, the same as before where it cannot).
 */

import { resolveCell } from '../model/cells';
import type { Frame, Stroke, ToolDescriptor, ToonDocument } from '../format/types';
import { renderStrokesLayer, STUDIO_PATHS } from './canvas2d';
import type { CellCache } from './cell-cache';
import type { Viewport } from './contract';

/** Where the cells are rasterized: a worker, or the page's own thread. */
export type WarmWay = 'workers' | 'page';

export function warmWay(can: { worker: boolean; offscreen2d: boolean }): WarmWay {
  return can.worker && can.offscreen2d ? 'workers' : 'page';
}

/** One cell to rasterize, as plain data a worker can be handed. */
export interface CellJob {
  readonly strokes: readonly Stroke[];
  readonly tools: readonly ToolDescriptor[];
  readonly viewport: Viewport;
  readonly width: number;
  readonly height: number;
}

/** Rasterizes cells elsewhere. Null: it could not, and the page draws the rest. */
export interface WarmCrew {
  draw(job: CellJob): Promise<{ image: CanvasImageSource; free: () => void } | null>;
}

/** What the studio shows, and the bitmap its cells are rasterized for. */
export interface WarmScene {
  readonly doc: ToonDocument;
  readonly frame: number;
  readonly tools: readonly ToolDescriptor[];
  readonly viewport: Viewport;
  readonly width: number;
  readonly height: number;
  /**
   * A playback: only the frames ahead, round the loop — this many, the
   * playback's window of frames (`playback-window.ts`), as far as the cell
   * cache has room.
   */
  readonly ahead?: number;
}

/** Runs a task when the page is free; returns the way to call it off. */
export type Schedule = (task: () => void) => () => void;

/** How far round the frame on screen the cells are made ready. */
const AROUND = 2;

export class CellWarmer {
  readonly #cache: CellCache;
  readonly #schedule: Schedule;
  #crew: WarmCrew | undefined;
  #cancel: (() => void) | null = null;
  #generation = 0;

  constructor(cache: CellCache, schedule: Schedule, crew?: WarmCrew) {
    this.#cache = cache;
    this.#schedule = schedule;
    this.#crew = crew;
  }

  /** Starts over for this scene: what was asked before and not done is dropped. */
  request(scene: WarmScene): void {
    this.stop();
    const generation = this.#generation;
    const jobs = this.#jobs(scene);
    const next = (): void => {
      const job = jobs.shift();
      if (!job || generation !== this.#generation) {
        this.#cancel = null;
        return;
      }
      this.#cancel = this.#schedule(() => {
        this.#cancel = null;
        if (generation !== this.#generation) return;
        void this.#run(job, scene).then(() => {
          if (generation === this.#generation) next();
        });
      });
    };
    next();
  }

  stop(): void {
    this.#generation += 1;
    this.#cancel?.();
    this.#cancel = null;
  }

  /** The cells to make ready, nearest first, as many as leave room for the frame on screen. */
  #jobs(scene: WarmScene): Frame[] {
    const { doc, frame, tools, viewport, width, height } = scene;
    const count = doc.layers[0]?.frames.length ?? 0;
    const visible = doc.layers.filter((layer) => !layer.hidden);
    const shown = visible.filter((layer) => frame < layer.frames.length && resolveCell(layer, frame).strokes.length > 0).length;
    // The frame on screen and its ghosts stay in: what is warmed must not push them out.
    let room = this.#cache.room(width, height) - 2 * shown;
    const order: number[] = [];
    if (scene.ahead) {
      for (let d = 1; d <= Math.min(scene.ahead, count - 1); d++) order.push((frame + d) % count);
    } else {
      for (let d = 1; d <= AROUND; d++) order.push(frame + d, frame - d);
    }
    const jobs: Frame[] = [];
    for (const index of order) {
      if (index < 0 || index >= count || index === frame) continue;
      for (const layer of visible) {
        const cell = resolveCell(layer, index);
        if (cell.strokes.length === 0 || room <= 0) continue;
        if (this.#cache.has(cell, tools, viewport, width, height)) continue;
        // The strokes as they are now: a cell gains strokes in place.
        jobs.push({ strokes: cell.strokes.slice() });
        room -= 1;
      }
    }
    return jobs;
  }

  async #run(cell: Frame, scene: WarmScene): Promise<void> {
    const { tools, viewport, width, height } = scene;
    if (this.#cache.has(cell, tools, viewport, width, height)) {
      return;
    }
    if (this.#crew) {
      try {
        const done = await this.#crew.draw({ strokes: cell.strokes, tools, viewport, width, height });
        if (done) {
          this.#cache.put(cell, tools, viewport, width, height, done.image, done.free);
          return;
        }
      } catch {
        // Fall to the page below.
      }
      // The crew could not draw: the page does it, now and from here on.
      this.#crew = undefined;
    }
    this.#cache.take(cell, tools, viewport, width, height, (buffer) => {
      renderStrokesLayer(cell, tools, buffer.ctx, viewport, undefined, STUDIO_PATHS);
    });
  }
}
