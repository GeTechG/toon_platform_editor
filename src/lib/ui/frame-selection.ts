/**
 * Pure frame-navigation and fps-clamp helpers — kept apart from the
 * runes state so they can be tested without the Svelte compiler.
 */

import { ONION_HISTORY_MAX_ALPHA, PLAYER_FPS_MAX, PLAYER_FPS_MIN } from '../format/constants';

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

/**
 * Onion-skin layers from the visited-frame history (Tonio): every frame the
 * user has been on lately except the active one, oldest first. The ladder is
 * `0.15 / history.length * (i + 1)` over the *unfiltered* history, exactly as
 * the reference composites it, so the freshest visit tops out at 0.15.
 */
export function onionHistoryLayers(
  history: readonly number[],
  active: number,
  frameCount: number,
): OnionLayer[] {
  const layers: OnionLayer[] = [];
  for (let i = 0; i < history.length; i++) {
    const index = history[i];
    if (index === active || index < 0 || index >= frameCount) {
      continue;
    }
    layers.push({ index, alpha: (ONION_HISTORY_MAX_ALPHA / history.length) * (i + 1) });
  }
  return layers;
}

/** Onion-skin renders only when enabled and not during playback. */
export function onionSkinVisible(enabled: boolean, playing: boolean): boolean {
  return enabled && !playing;
}

/** Clamps fps to the profile's player range (5–24 by default, 1–30 under Tonio). */
export function clampPlayerFps(
  value: number,
  [min, max]: readonly [number, number] = [PLAYER_FPS_MIN, PLAYER_FPS_MAX],
): number {
  const fps = Math.round(value);
  if (!Number.isFinite(fps)) {
    return min;
  }
  return Math.min(max, Math.max(min, fps));
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
