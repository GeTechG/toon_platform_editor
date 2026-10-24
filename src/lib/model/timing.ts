/**
 * A film's time in ticks: a tick is 1/`frame_rate` s, and frame `i` stays on
 * screen `holds[i]` ticks (one without them). Built once per playback — the
 * starts are prefix sums, so finding the frame of a tick is a binary search
 * even over the format's 100 000 frames.
 */
export interface FilmTiming {
  /** The film's length in ticks. */
  readonly total: number;
  /** The tick frame `frame` begins on; `start(count)` is `total`. */
  start(frame: number): number;
  /** The frame on screen at `tick`, held to the film's ends. */
  frameAt(tick: number): number;
}

export function filmTiming(holds: readonly number[] | undefined, frames: number): FilmTiming {
  if (!holds) {
    return {
      total: frames,
      start: (frame) => frame,
      frameAt: (tick) => Math.min(frames - 1, Math.max(0, Math.floor(tick))),
    };
  }
  const starts = new Float64Array(frames + 1);
  for (let i = 0; i < frames; i++) starts[i + 1] = starts[i] + (holds[i] ?? 1);
  const total = starts[frames];
  return {
    total,
    start: (frame) => starts[Math.min(frames, Math.max(0, frame))],
    frameAt(tick) {
      // The last frame whose start is at or before the tick.
      let lo = 0;
      let hi = frames - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= tick) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
  };
}
