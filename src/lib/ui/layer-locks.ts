/**
 * The layer lock: a habit of the desk, not part of the toon. It lives in the
 * draft beside the colour tags, follows its layer as they do, and keeps new
 * edits off the layer — a stroke, an eraser, a fill, a paste — while the
 * layer's own history still goes back and forth.
 */
import type { ToonDocument } from '../format/types';

/** Locks read back for a document of `count` layers; anything unusable is unlocked. */
export function normalizeLayerLocks(saved: unknown, count: number): boolean[] {
  const list = Array.isArray(saved) ? saved : [];
  return Array.from({ length: count }, (_, i) => list[i] === true);
}

/**
 * Why an edit of the cells of `layers` is refused, or null. A hidden layer
 * refuses everything, its undo too (owner, twelfth audit); a locked one only
 * what is new — `history` is an undo or a redo.
 */
export function editRefusal(
  doc: ToonDocument,
  locks: readonly boolean[],
  layers: readonly number[],
  history = false,
): 'hidden' | 'locked' | null {
  if (layers.some((layer) => doc.layers[layer]?.hidden)) return 'hidden';
  if (!history && layers.some((layer) => locks[layer] === true)) return 'locked';
  return null;
}

/** The studio's own per-layer state: the colour tags and the locks. */
export interface Desk {
  layerColors: number[];
  layerLocks: boolean[];
}

/**
 * What the colour tags and the locks are after a structure step is taken back
 * or redone. A delete or a move changes the layers, so the step brings back
 * the desk of its layers; a look changes no layer, so the desk stays as it is
 * now — a lock set after the slider stays set.
 */
export function deskAfter(step: Desk & { looked?: true }, now: Desk): Desk {
  const desk = step.looked ? now : step;
  return { layerColors: desk.layerColors.slice(), layerLocks: desk.layerLocks.slice() };
}
