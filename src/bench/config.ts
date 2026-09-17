/**
 * Benchmark run parameters and pass/fail thresholds.
 *
 * Defaults are documented here; every field is overridable via URL query
 * params so the same page runs with different corpus sizes / thresholds on a
 * phone or under Playwright without a rebuild (e.g. `bench.html?frames=200`).
 */

export interface BenchConfig {
  /** L — layers in the synthetic corpus (1 = Multator class, 5 = Toonio class). */
  layers: number;
  /** N — number of frames in the synthetic corpus. */
  frames: number;
  /** M — strokes committed per frame. */
  strokesPerFrame: number;
  /** Nominal raw points sampled per synthetic stroke (Lang may reduce). */
  pointsPerStroke: number;
  /** Every Nth committed stroke uses Tonio; 0 means Multator-only. */
  mixedEvery: number;

  /** input-to-paint: p95 latency must be ≤ this (ms). */
  latencyP95MaxMs: number;
  /** Points fed through the live-stroke latency probe. */
  latencyPoints: number;

  /** Playback target rate (fps). */
  targetFps: number;
  /** A delivered frame is "on time" if its interval ≤ factor × target interval. */
  frameToleranceFactor: number;
  /** Fraction of delivered frames that must be on time to pass. */
  minOnTimeFraction: number;
  /** Playback duration for the fps probe (ms). */
  playbackMs: number;

  /** alloc-loop: allowed steady-state heap growth over the window (bytes). */
  heapGrowthMaxBytes: number;
  /** Warm-up before heap sampling starts (ms). */
  heapWarmupMs: number;
}

export const DEFAULT_CONFIG: BenchConfig = {
  // Multator class: one layer, ~100 frames, dozens of strokes per frame.
  // The multi-layer Toonio-class profile is `bench.html?layers=5`.
  layers: 1,
  frames: 100,
  strokesPerFrame: 20,
  pointsPerStroke: 64,
  mixedEvery: 0,

  latencyP95MaxMs: 32, // 2 frames at 60 Hz
  latencyPoints: 400,

  targetFps: 24,
  frameToleranceFactor: 1.5,
  minOnTimeFraction: 0.95,
  playbackMs: 5000,

  // 8 MB per measurement window is an empirical start; calibrate it on a real
  // 2 GB Android device (see tasks 5.2). Left as a knob.
  heapGrowthMaxBytes: 8 * 1024 * 1024,
  heapWarmupMs: 1000,
};

/** Reads overrides from a query string, falling back to `base` per field. */
export function configFromQuery(search: string, base: BenchConfig = DEFAULT_CONFIG): BenchConfig {
  const p = new URLSearchParams(search);
  const result = { ...base };
  for (const key of Object.keys(base) as (keyof BenchConfig)[]) {
    const raw = p.get(key);
    if (raw === null) {
      continue;
    }
    const v = Number(raw);
    if (Number.isFinite(v)) {
      result[key] = v;
    }
  }
  return result;
}
