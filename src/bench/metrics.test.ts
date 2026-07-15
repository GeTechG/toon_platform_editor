import { describe, expect, it } from 'bun:test';
import { frameTiming, heapGrowthBytes, percentile } from './metrics';

describe('percentile', () => {
  it('is nearest-rank', () => {
    const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(v, 95)).toBe(100);
    expect(percentile(v, 50)).toBe(50);
    expect(percentile(v, 100)).toBe(100);
  });

  it('ignores input order', () => {
    expect(percentile([50, 10, 90, 30], 95)).toBe(90);
  });

  it('is NaN for empty input', () => {
    expect(Number.isNaN(percentile([], 95))).toBe(true);
  });
});

describe('frameTiming', () => {
  const target = 1000 / 24; // ~41.7 ms

  it('counts intervals over the tolerance as dropped', () => {
    // 3 on time (≤ 1.5×), 1 slow.
    const t = frameTiming([40, 41, 42, 200], target, 1.5);
    expect(t.dropped).toBe(1);
    expect(t.onTimeFraction).toBeCloseTo(0.75, 5);
  });

  it('reports achieved fps from the mean interval', () => {
    const t = frameTiming([50, 50, 50, 50], target, 1.5);
    expect(t.achievedFps).toBeCloseTo(20, 5);
  });

  it('treats empty input as a clean pass', () => {
    expect(frameTiming([], target, 1.5)).toEqual({ onTimeFraction: 1, dropped: 0, achievedFps: 0 });
  });
});

describe('heapGrowthBytes', () => {
  it('recovers a linear rise', () => {
    const samples = [
      { t: 0, bytes: 1_000_000 },
      { t: 1000, bytes: 2_000_000 },
      { t: 2000, bytes: 3_000_000 },
    ];
    expect(heapGrowthBytes(samples)).toBeCloseTo(2_000_000, 0);
  });

  it('sees through GC sawtooth to a flat trend', () => {
    // Bounces up and down but no net drift — trend ≈ 0, not the last-first jump.
    const samples = [
      { t: 0, bytes: 5_000_000 },
      { t: 1000, bytes: 8_000_000 },
      { t: 2000, bytes: 4_000_000 },
      { t: 3000, bytes: 7_000_000 },
      { t: 4000, bytes: 5_000_000 },
    ];
    expect(Math.abs(heapGrowthBytes(samples))).toBeLessThan(1_000_000);
  });

  it('is zero with fewer than two samples', () => {
    expect(heapGrowthBytes([{ t: 0, bytes: 1 }])).toBe(0);
  });
});
