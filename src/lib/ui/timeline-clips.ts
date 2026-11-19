import type { Cell } from '../format/types';
import { keyOf } from '../model/cells';

interface Clip {
  frame: Cell;
  key: number;
  start: number;
  end: number;
}

/** The visible drawing spans. Keep the key's real position when its head is offscreen. */
function sourceClips(frames: readonly Cell[], first: number, end: number): Clip[] {
  const clips: Clip[] = [];
  if (first >= end || first >= frames.length) return clips;
  let key = keyOf(frames, first);
  for (let i = first + 1; key < end && key < frames.length; i++) {
    while (i < frames.length && frames[i] === null) i++;
    clips.push({ frame: frames[key], key, start: key, end: i });
    key = i;
  }
  return clips;
}

export function snappedDuration(original: number, max: number, distance: number, pitch: number): number {
  const ticks = Math.sign(distance) * Math.round(Math.abs(distance) / pitch);
  return Math.max(1, Math.min(max, original + ticks));
}

/** Keep finger travel usable at overview zoom, with a small margin before reversing a snap. */
export function touchDuration(original: number, max: number, distance: number, pitch: number, current: number): number {
  const step = Math.max(32, pitch);
  const offset = distance - (current - original) * step;
  const margin = 4;
  if (Math.abs(offset) < step / 2 + margin) return current;
  return snappedDuration(original, max, distance - Math.sign(offset) * margin, step);
}

export interface ClipResize {
  start: number;
  duration: number;
  /** Preview duration in whole ticks. */
  to: number;
}

export function timelineClips(frames: readonly Cell[], first: number, end: number, resize?: ClipResize): Clip[] {
  if (!resize) return sourceClips(frames, first, end);
  const { start, duration, to } = resize;
  const before = sourceClips(frames, first, Math.min(start, end));
  const edge = start + to;
  if (start < end && edge > first) before.push({ frame: frames[start], key: start, start, end: edge });

  const oldEdge = start + duration;
  const shift = to - duration;
  // Shortening the last drawing reveals a blank until the end of the film.
  if (oldEdge === frames.length) {
    if (edge < frames.length && edge < end && frames.length > first) {
      before.push({ frame: null, key: -1, start: edge, end: frames.length });
    }
    return before;
  }
  const from = Math.max(oldEdge, Math.min(frames.length - 1, Math.floor(first - shift)));
  for (const clip of sourceClips(frames, from, Math.ceil(end - shift))) {
    clip.start += shift;
    clip.end = clip.end === frames.length ? Math.max(frames.length, clip.start + 1) : clip.end + shift;
    if (clip.end > first && clip.start < end) before.push(clip);
  }
  return before;
}
