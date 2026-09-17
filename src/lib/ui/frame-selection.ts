/**
 * Pure frame-navigation and fps-clamp helpers — kept apart from the
 * runes state so they can be tested without the Svelte compiler.
 */

import { PLAYER_FPS_MAX, PLAYER_FPS_MIN } from '../format/constants';

/**
 * Active frame after removing removedIndex. 'next' (default): the right
 * neighbor, or the last frame. 'previous' (Multator): the frame before the
 * removed one, or the first frame.
 */
export function activeFrameAfterRemove(
  removedIndex: number,
  newFrameCount: number,
  prefer: 'next' | 'previous' = 'next',
): number {
  if (prefer === 'previous') {
    return Math.max(0, Math.min(removedIndex - 1, newFrameCount - 1));
  }
  return Math.min(removedIndex, newFrameCount - 1);
}

/** Frame playback starts from: the active frame, or the first when the profile plays from start. */
export function playbackStartFrame(activeFrame: number, playFromStart: boolean): number {
  return playFromStart ? 0 : activeFrame;
}

export interface OnionLayer {
  /** Frame index to draw. */
  index: number;
  /** Opacity for this layer (fainter the further from the active frame). */
  alpha: number;
}

/**
 * Onion-skin layers for the active frame: up to `alphas.length` previous and
 * (with sides = 'both') next neighbors, each fainter with distance. Farthest
 * first so nearer frames composite on top; neighbors outside the document
 * are skipped.
 */
export function onionLayers(
  active: number,
  frameCount: number,
  alphas: readonly number[],
  sides: 'both' | 'previous' = 'both',
): OnionLayer[] {
  const layers: OnionLayer[] = [];
  for (let distance = alphas.length; distance >= 1; distance--) {
    const alpha = alphas[distance - 1];
    const prev = active - distance;
    const next = active + distance;
    if (prev >= 0) {
      layers.push({ index: prev, alpha });
    }
    if (sides === 'both' && next < frameCount) {
      layers.push({ index: next, alpha });
    }
  }
  return layers;
}

/** Onion-skin renders only when enabled and not during playback. */
export function onionSkinVisible(enabled: boolean, playing: boolean): boolean {
  return enabled && !playing;
}

/** Clamps fps to the player range (5–24). */
export function clampPlayerFps(value: number): number {
  const fps = Math.round(value);
  if (!Number.isFinite(fps)) {
    return PLAYER_FPS_MIN;
  }
  return Math.min(PLAYER_FPS_MAX, Math.max(PLAYER_FPS_MIN, fps));
}

/**
 * Active layer after removing `removed`. The layer that slides into the freed
 * position stays active; when the top layer went, the one below it does.
 */
export function activeLayerAfterRemove(
  active: number,
  removed: number,
  newLayerCount: number,
): number {
  if (active > removed) {
    return active - 1;
  }
  return active < removed ? active : Math.min(removed, newLayerCount - 1);
}

/**
 * Active layer after moving `from` to `to` — the moved layer keeps the
 * selection, and the layers it passed shift by one.
 */
export function activeLayerAfterMove(active: number, from: number, to: number): number {
  if (active === from) {
    return to;
  }
  let index = active;
  if (index > from) {
    index -= 1;
  }
  if (index >= to) {
    index += 1;
  }
  return index;
}

/**
 * Target row of a layer drag: rows have a fixed height, so pointer travel is
 * whole rows from where the drag started, clamped to the list.
 */
export function dragTargetIndex(
  from: number,
  dy: number,
  rowHeight: number,
  count: number,
): number {
  const target = from + Math.round(dy / rowHeight);
  return Math.min(count - 1, Math.max(0, target));
}

/** Color-picker source: the visible composite, or the active layer alone. */
export type PickSource = 'canvas' | 'layer';

/** Alt takes the active layer for one click without changing the setting. */
export function pickSource(setting: PickSource, altKey: boolean): PickSource {
  return altKey ? 'layer' : setting;
}
