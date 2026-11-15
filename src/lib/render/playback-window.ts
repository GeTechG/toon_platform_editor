/**
 * The window of ready frames a playback holds: the player's and the studio's.
 *
 * A frame of the sheet is its whole bitmap — 3.7 MB at 1280×720 — and a film
 * held whole was 570 MB at 154 frames, past what a weak device has. The owner,
 * 2026-11-16: draw ahead a limited number, or it eats all the memory; and
 * flexibly, for a device too slow to keep up drawing as it plays. A film that
 * fits is held whole, as before; a longer one holds the frames ahead of the one
 * on screen, round the loop, and lets the played ones go.
 */

import { cellBudget } from './cell-cache';

/** Two: the frame on screen and the next, or there is nothing to play from. */
const WINDOW_MIN = 2;

/** How many sheets of `width` × `height` the device's memory step holds. */
export function playbackWindow(deviceMemory: number | undefined, width: number, height: number): number {
  return Math.max(WINDOW_MIN, Math.floor(cellBudget(deviceMemory) / (width * height * 4)));
}

/** The frames the window holds: from the one on screen onwards, round the loop. */
export function windowFrames(total: number, from: number, window: number): number[] {
  const frames: number[] = [];
  for (let step = 0; step < Math.min(total, window); step++) frames.push((from + step) % total);
  return frames;
}

export interface Pace {
  /** Frames in the film. */
  readonly total: number;
  /** Frames the window holds. */
  readonly window: number;
  /** Frames shown a second. */
  readonly playRate: number;
  /** Frames rasterized a second, as measured; undefined before the first. */
  readonly rasterRate: number | undefined;
}

/**
 * How many frames in a row must be ready before the clock starts. A film that
 * fits is waited out whole. A longer one waits a second of itself if the
 * drawing keeps up, else as many as keep the first lap ahead of the drawing —
 * the lap shows `total` while the drawing makes `total × raster / play`, the
 * rest must be ready — and never more than the window.
 */
export function startNeed({ total, window, playRate, rasterRate }: Pace): number {
  if (total <= window) return total;
  const second = Math.max(1, Math.ceil(playRate));
  const short = rasterRate === undefined || rasterRate >= playRate
    ? 0
    : Math.ceil(total * (1 - rasterRate / playRate));
  return Math.min(window, Math.max(second, short));
}

/** The frames ready in a row from `from` onwards, round the loop. */
export function aheadReady(held: (frame: number) => boolean, total: number, from: number): number {
  let count = 0;
  while (count < total && held((from + count) % total)) count++;
  return count;
}

/**
 * The first frame the clock went by, from `from` (on screen) to `to` (where it
 * landed), that is not ready; null if every one is. `laps`: how many times it
 * went past the film's end. Landing behind where it left takes one of them;
 * any other is a whole lap gone by (a tab put away longer than the film), and
 * every frame was passed over.
 */
export function firstUnready(
  held: (frame: number) => boolean,
  total: number,
  from: number,
  to: number,
  laps: number,
): number | null {
  const ahead = (((to - from) % total) + total) % total;
  const whole = Math.max(0, laps - (to < from ? 1 : 0));
  const steps = Math.min(ahead + total * whole, 2 * total);
  for (let step = 1; step <= steps; step++) {
    const frame = (from + step) % total;
    if (!held(frame)) return frame;
  }
  return null;
}

