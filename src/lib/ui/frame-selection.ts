/**
 * Pure frame-navigation and fps-clamp helpers — kept apart from the
 * runes state so they can be tested without the Svelte compiler.
 */

import {
  ONION_HISTORY_LENGTH,
  ONION_HISTORY_MAX_ALPHA,
  PLAYER_FPS_MAX,
  PLAYER_FPS_MIN,
} from '../format/constants';

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

/** The stretch playback runs over, and the frame it begins on. */
export interface PlaybackRange {
  readonly start: number;
  readonly end: number;
  readonly first: number;
}

/**
 * What Space (and Shift+Space) plays. Under Toonio the selection is the range:
 * more than one selected frame plays `[min..max]` from its start, a lone cell
 * plays the whole document from frame 1, and a one-frame document does not
 * play at all (`bundle:8405-8433`). The other presets keep their own rule —
 * the whole document from the active frame, or from the first one (Multator).
 * `fromActive` is Shift: begin where the cursor is, inside the same range.
 */
export function playbackRange(
  activeFrame: number,
  selection: CellSelection,
  frameCount: number,
  ux: { readonly playbackRange: 'document' | 'selection'; readonly playFromStart: boolean },
  fromActive: boolean,
): PlaybackRange | null {
  if (ux.playbackRange !== 'selection') {
    const first = fromActive ? activeFrame : playbackStartFrame(activeFrame, ux.playFromStart);
    return { start: 0, end: frameCount - 1, first };
  }
  if (frameCount < 2) {
    return null;
  }
  const spanned = selection.frames.length > 1;
  const start = spanned ? Math.min(...selection.frames) : 0;
  const end = spanned ? Math.max(...selection.frames) : frameCount - 1;
  const first = fromActive ? Math.min(end, Math.max(start, activeFrame)) : start;
  return { start, end, first };
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

/**
 * Tonio's visited-frame history after a move: the reference records the frame
 * being *left* (`AddHistory(prev)`, `bundle:11026-11033`), not the one arrived
 * at, so the ghosts trail the cursor. A move that goes nowhere records
 * nothing, and only the last three visits are kept.
 *
 * `newFrame` is left out when the index is no guide — inserting a frame in
 * front of the active one keeps the number but puts a different cell under it,
 * and the reference pushes unconditionally there.
 */
export function pushVisited(
  history: readonly number[],
  leftFrame: number,
  newFrame?: number,
): number[] {
  if (leftFrame === newFrame) {
    return [...history];
  }
  return [...history, leftFrame].slice(-ONION_HISTORY_LENGTH);
}

/**
 * The history after a frame was inserted at `insertedAt`: everything from
 * there on moved one to the right, so the ghosts stay on the cells they were
 * drawn from (`bundle:11027-11029`).
 */
export function shiftVisited(history: readonly number[], insertedAt: number): number[] {
  return history.map((index) => (index >= insertedAt ? index + 1 : index));
}

/**
 * Onion-skin renders only when enabled, not during playback, and never under
 * the pipette — the reference hides it so a pick reads the drawing itself
 * rather than a ghost of the neighbouring frame.
 */
export function onionSkinVisible(enabled: boolean, playing: boolean, tool = 'pencil'): boolean {
  return enabled && !playing && tool !== 'pipette';
}

/**
 * Index `i` folded back into a list of `n` — the arrows and the ⏴/⏵ buttons
 * wrap round both ends rather than stopping at them.
 */
export function wrapIndex(i: number, n: number): number {
  return ((i % n) + n) % n;
}

/**
 * Where `addLayer` inserts the new row. Layers are stored bottom-up, so "under
 * the active one" is the active index itself and "over it" is one past
 * (`bundle:8485-8487`); Ctrl asks for the other one.
 */
export function newLayerIndex(
  activeLayer: number,
  position: 'above' | 'below',
  ctrlKey: boolean,
): number {
  const above = ctrlKey ? position === 'below' : position === 'above';
  return above ? activeLayer + 1 : activeLayer;
}

/** How long the zoom window stays up after a wheel zoom (reference: 2 seconds). */
export const SCALE_MENU_MS = 2000;

/**
 * The zoom window is up while the hand is held, and for a moment after a
 * wheel zoom so the new scale can be read.
 */
export function scaleMenuVisible(tool: string, until: number, now: number): boolean {
  return tool === 'drag' || now < until;
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

/** A timeline cell: one layer's slot in one frame. */
export interface Cell {
  readonly frame: number;
  readonly layer: number;
}

/** How far the document reaches, in cells. */
export interface CellBounds {
  readonly frames: number;
  readonly layers: number;
}

/**
 * Selected cells as the cross product of a frame list and a layer list. A
 * Shift range fills both contiguously; Ctrl leaves gaps in the layers.
 */
export interface CellSelection {
  readonly frames: readonly number[];
  readonly layers: readonly number[];
}

/**
 * Whether a navigation keeps the block selection: the reference collapses it
 * only when the cell you land on is outside it (`manual && !inSelection`), so
 * arrows, J/L and the ⏴/⏵ buttons walk *inside* a selection without losing it.
 */
export function keepsSelection(selection: CellSelection, cell: Cell): boolean {
  return selection.frames.includes(cell.frame) && selection.layers.includes(cell.layer);
}

function span(a: number, b: number, limit: number): number[] {
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(limit - 1, Math.max(a, b));
  const out: number[] = [];
  for (let i = lo; i <= hi; i++) {
    out.push(i);
  }
  return out;
}

/** The rectangle of cells between the anchor and the target, clamped to the document. */
export function rangeSelection(anchor: Cell, target: Cell, bounds: CellBounds): CellSelection {
  return {
    frames: span(anchor.frame, target.frame, bounds.frames),
    layers: span(anchor.layer, target.layer, bounds.layers),
  };
}

/**
 * Where Shift+arrow spans to: one step past the block's far edge — the side
 * away from the active cell, which is the anchor and stays put. Clamped, not
 * wrapped: a range that jumped to the other end would select everything.
 */
export function extendTarget(
  selection: CellSelection,
  active: Cell,
  dFrame: number,
  dLayer: number,
  bounds: CellBounds,
): Cell {
  const far = (list: readonly number[], at: number) =>
    Math.min(...list) === at ? Math.max(...list) : Math.min(...list);
  const clamp = (value: number, limit: number) => Math.max(0, Math.min(limit - 1, value));
  return {
    frame: clamp(far(selection.frames, active.frame) + dFrame, bounds.frames),
    layer: clamp(far(selection.layers, active.layer) + dLayer, bounds.layers),
  };
}

/**
 * Ctrl+click: the layer joins or leaves the selection, which never empties.
 * The reference only reads Ctrl on a cell whose frame is already selected and
 * whose row is not the active one (`bundle:8957-8968`); anywhere else the
 * modifier is ignored, so `null` means "treat it as a plain click".
 */
export function toggleLayerInSelection(
  selection: CellSelection,
  cell: Cell,
  activeLayer: number,
): CellSelection | null {
  if (!selection.frames.includes(cell.frame) || cell.layer === activeLayer) {
    return null;
  }
  const layers = selection.layers.includes(cell.layer)
    ? selection.layers.filter((index) => index !== cell.layer)
    : [...selection.layers, cell.layer].sort((a, b) => a - b);
  return layers.length === 0 ? selection : { frames: selection.frames, layers };
}

/**
 * Where a copied block lands: on the selection, not next to the active cell.
 * Every selected frame is filled — a short buffer repeats over them — while
 * the rows pair from the top down, so a buffer narrower than the selection
 * takes its topmost rows and the ones below are left alone
 * (`bundle:8192-8250`). A single selected cell still means a single paste.
 */
export function pasteTargetFromSelection(
  selection: CellSelection,
  buffer: CellBounds,
): CellSelection {
  const rows = Math.min(selection.layers.length, buffer.layers);
  return {
    frames: [...selection.frames],
    layers: selection.layers.slice(selection.layers.length - rows),
  };
}

/**
 * What the brush cursor is made of (reference `tools.js:80-100`): a ring the
 * width of the brush, and a cross when the brush is too thin to aim with or
 * so thick its ring hides the point. A thin brush with the cross on drops the
 * ring — two pixels of circle are noise, not a cursor.
 */
export function cursorShape(width: number, crossCursor: boolean): { ring: boolean; cross: boolean } {
  const thin = width <= 3;
  return { ring: !(thin && crossCursor), cross: (thin && crossCursor) || width >= 25 };
}
