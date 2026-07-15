/**
 * Pure frame-navigation and fps-clamp helpers — kept apart from the
 * runes state so they can be tested without the Svelte compiler.
 */

import { PLAYER_FPS_MAX, PLAYER_FPS_MIN } from '../format/constants';

/** Active frame after removing removedIndex: right neighbor or the last frame. */
export function activeFrameAfterRemove(removedIndex: number, newFrameCount: number): number {
  return Math.min(removedIndex, newFrameCount - 1);
}

export interface OnionLayer {
  /** Frame index to draw. */
  index: number;
  /** Opacity for this layer (fainter the further from the active frame). */
  alpha: number;
}

/**
 * Onion-skin layers for the active frame: up to `alphas.length` previous and
 * next neighbors, each fainter with distance. Farthest first so nearer frames
 * composite on top; neighbors outside the document are skipped.
 */
export function onionLayers(
  active: number,
  frameCount: number,
  alphas: readonly number[],
): OnionLayer[] {
  const layers: OnionLayer[] = [];
  for (let distance = alphas.length; distance >= 1; distance--) {
    const alpha = alphas[distance - 1];
    const prev = active - distance;
    const next = active + distance;
    if (prev >= 0) {
      layers.push({ index: prev, alpha });
    }
    if (next < frameCount) {
      layers.push({ index: next, alpha });
    }
  }
  return layers;
}

/** Onion-skin renders only when enabled and not during playback. */
export function onionSkinVisible(enabled: boolean, playing: boolean): boolean {
  return enabled && !playing;
}

/** Clamps fps to the MVP player range (12–24). */
export function clampPlayerFps(value: number): number {
  const fps = Math.round(value);
  if (!Number.isFinite(fps)) {
    return PLAYER_FPS_MIN;
  }
  return Math.min(PLAYER_FPS_MAX, Math.max(PLAYER_FPS_MIN, fps));
}
