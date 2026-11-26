import { frameTiming, percentile } from '../../src/bench/metrics';

export interface Result {
  p95: number;
  fps: number;
  late: number;
}

export async function measureDrawing(
  draw: (elapsed: number) => void,
  nextFrame: () => Promise<number>,
  referenceMs: number,
): Promise<Result> {
  const durations: number[] = [];
  const intervals: number[] = [];
  const start = await nextFrame();
  let now = start;
  while (now - start < 2200) {
    const time = performance.now();
    draw(now - start);
    durations.push(performance.now() - time);
    const next = await nextFrame();
    intervals.push(next - now);
    now = next;
  }
  const timing = frameTiming(intervals, referenceMs, 1.5);
  return { p95: percentile(durations, 95), fps: timing.achievedFps, late: timing.dropped };
}
