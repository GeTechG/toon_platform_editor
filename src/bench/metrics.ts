/**
 * Pure metric math for the benchmark — no DOM, no timers, so it is unit
 * testable in bun. The browser drivers (run.ts) feed raw samples in.
 */

/** Nearest-rank percentile (p in 0..100). NaN for an empty set. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    return NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx];
}

export interface FrameTiming {
  /** Fraction of intervals within the tolerance (0..1). */
  onTimeFraction: number;
  /** Number of intervals that missed the tolerance. */
  dropped: number;
  /** Mean delivered rate over the window (fps). */
  achievedFps: number;
}

/**
 * Judges playback: an interval is "on time" if ≤ factor × the target interval.
 * Empty input is treated as a clean pass (nothing was dropped).
 */
export function frameTiming(
  intervals: readonly number[],
  targetIntervalMs: number,
  factor: number,
): FrameTiming {
  if (intervals.length === 0) {
    return { onTimeFraction: 1, dropped: 0, achievedFps: 0 };
  }
  const limit = targetIntervalMs * factor;
  let onTime = 0;
  let total = 0;
  for (const iv of intervals) {
    total += iv;
    if (iv <= limit) {
      onTime++;
    }
  }
  return {
    onTimeFraction: onTime / intervals.length,
    dropped: intervals.length - onTime,
    achievedFps: total > 0 ? 1000 / (total / intervals.length) : 0,
  };
}

export interface HeapSample {
  /** Timestamp (ms). */
  t: number;
  /** usedJSHeapSize (bytes). */
  bytes: number;
}

/**
 * Steady-state heap growth over the sampling window, as the least-squares
 * trend line's rise (slope × window). A trend line ignores GC sawtooth, which
 * a naive last-minus-first would mistake for a drop or a leak.
 */
export function heapGrowthBytes(samples: readonly HeapSample[]): number {
  const n = samples.length;
  if (n < 2) {
    return 0;
  }
  const t0 = samples[0].t;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const s of samples) {
    const x = s.t - t0;
    sx += x;
    sy += s.bytes;
    sxx += x * x;
    sxy += x * s.bytes;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) {
    return 0;
  }
  const slopeBytesPerMs = (n * sxy - sx * sy) / denom;
  const windowMs = samples[n - 1].t - t0;
  return slopeBytesPerMs * windowMs;
}
