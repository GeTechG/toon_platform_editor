// A one-frame publication replayed the way it was drawn: stroke by stroke,
// the bottom layer first. Pure — the player asks how long the show is and
// what stands on the sheet at a step, and draws that as it draws any frame.
import type { ToonDocument } from '../format/types';

/** A stroke every tenth of a second (the owner, 2026-10-06). */
export const REPLAY_FPS = 10;
/** Strokes a viewer will see appear: hidden layers are never drawn. */
function visibleStrokes(doc: ToonDocument): number {
  let count = 0;
  for (const layer of doc.layers) {
    if (!layer.hidden) {
      count += layer.frames[0].strokes.length;
    }
  }
  return count;
}

/** What the player counts and how fast: frames of an animation, or steps of a
 *  drawing being replayed. */
export function playLength(doc: ToonDocument): { frames: number; fps: number; replay: boolean } {
  const frames = doc.layers[0].frames.length;
  const strokes = frames === 1 ? visibleStrokes(doc) : 0;
  if (strokes < 2) {
    return { frames, fps: doc.frame_rate, replay: false };
  }
  return { frames: strokes, fps: REPLAY_FPS, replay: true };
}

/** The one-frame document as it stood after `step + 1` strokes. Built per
 *  step and dropped: a frame per stroke kept around would be n² references. */
export function replayAt(doc: ToonDocument, step: number): ToonDocument {
  let left = step + 1;
  const layers = doc.layers.map((layer) => {
    if (layer.hidden) {
      return layer;
    }
    const strokes = layer.frames[0].strokes.slice(0, Math.max(0, left));
    left -= strokes.length;
    return { ...layer, frames: [{ strokes }] };
  });
  return { ...doc, layers };
}

/** Where a press of play starts a replay: over again from the finished
 *  drawing, on from anywhere else. */
export function replayStart(current: number, total: number): number {
  return current >= total - 1 ? 0 : current;
}

/** A replay is played once: it is over on its last step, or when the clock
 *  skipped that step and came round. */
export function replayEnded(previous: number, index: number, total: number): boolean {
  return index >= total - 1 || index < previous;
}
