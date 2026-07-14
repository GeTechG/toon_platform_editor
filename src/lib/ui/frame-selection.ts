/**
 * Pure frame-navigation and fps-clamp helpers — kept apart from the
 * runes state so they can be tested without the Svelte compiler.
 */

import { PLAYER_FPS_MAX, PLAYER_FPS_MIN } from '../format/constants';

/** Active frame after removing removedIndex: right neighbor or the last frame. */
export function activeFrameAfterRemove(removedIndex: number, newFrameCount: number): number {
  return Math.min(removedIndex, newFrameCount - 1);
}

/** Clamps fps to the MVP player range (12–24). */
export function clampPlayerFps(value: number): number {
  const fps = Math.round(value);
  if (!Number.isFinite(fps)) {
    return PLAYER_FPS_MIN;
  }
  return Math.min(PLAYER_FPS_MAX, Math.max(PLAYER_FPS_MIN, fps));
}
