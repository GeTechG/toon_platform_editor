/**
 * Browser drivers: exercise the real render path over the synthetic corpus and
 * turn raw samples into pass/fail metrics. Runs only in a browser (rAF,
 * performance.now, canvas). The pure math lives in metrics.ts.
 */

import { DEFAULT_BRUSH_SIZE_LOGICAL } from '../lib/format/constants';
import type { ToonDocument } from '../lib/format/types';
import { LoopPlayer } from '../lib/player/player';
import { brushWidthDoc } from '../lib/tools/stroke-builder';
import type { BenchConfig } from './config';
import { FrameCompositor, type LiveStroke } from './compose';
import { buildCorpus, syntheticRawPoints } from './corpus';
import { frameTiming, heapGrowthBytes, percentile, type HeapSample } from './metrics';

export type Verdict = 'PASS' | 'FAIL' | 'SKIP';

export interface MetricResult {
  name: string;
  value: string;
  threshold: string;
  verdict: Verdict;
}

export interface BenchResult {
  config: BenchConfig;
  corpus: { frames: number; strokesPerFrame: number; totalStrokes: number };
  metrics: MetricResult[];
  overall: 'PASS' | 'FAIL';
}

const nextFrame = (): Promise<number> => new Promise((r) => requestAnimationFrame(r));

function usedHeap(): number | null {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? mem.usedJSHeapSize : null;
}

export async function runBench(canvas: HTMLCanvasElement, cfg: BenchConfig): Promise<BenchResult> {
  const doc = buildCorpus({
    frames: cfg.frames,
    strokesPerFrame: cfg.strokesPerFrame,
    pointsPerStroke: cfg.pointsPerStroke,
  });
  const compositor = new FrameCompositor(canvas);

  const latencies = await probeLatency(compositor, doc, cfg);
  const { intervals, heap } = await probePlayback(compositor, doc, cfg);

  const p95 = percentile(latencies, 95);
  const timing = frameTiming(intervals, 1000 / cfg.targetFps, cfg.frameToleranceFactor);
  const growth = heap.length >= 2 ? heapGrowthBytes(heap) : null;
  const heapMax = (cfg.heapGrowthMaxBytes / (1024 * 1024)).toFixed(1);

  const metrics: MetricResult[] = [
    {
      name: 'input-to-paint p95',
      value: `${p95.toFixed(1)} ms`,
      threshold: `≤ ${cfg.latencyP95MaxMs} ms`,
      verdict: p95 <= cfg.latencyP95MaxMs ? 'PASS' : 'FAIL',
    },
    {
      name: 'playback fps',
      value: `${timing.achievedFps.toFixed(1)} fps · ${(timing.onTimeFraction * 100).toFixed(1)}% on-time · ${timing.dropped} dropped`,
      threshold: `≥ ${(cfg.minOnTimeFraction * 100).toFixed(0)}% within ${cfg.frameToleranceFactor}× @ ${cfg.targetFps} fps`,
      verdict: timing.onTimeFraction >= cfg.minOnTimeFraction ? 'PASS' : 'FAIL',
    },
    growth === null
      ? {
          name: 'alloc-loop (heap)',
          value: 'heap-size unavailable',
          threshold: `≤ ${heapMax} MB`,
          verdict: 'SKIP',
        }
      : {
          name: 'alloc-loop (heap)',
          value: `${(growth / (1024 * 1024)).toFixed(2)} MB growth`,
          threshold: `≤ ${heapMax} MB`,
          verdict: growth <= cfg.heapGrowthMaxBytes ? 'PASS' : 'FAIL',
        },
  ];

  return {
    config: cfg,
    corpus: {
      frames: doc.frames.length,
      strokesPerFrame: cfg.strokesPerFrame,
      totalStrokes: doc.frames.reduce((n, f) => n + f.strokes.length, 0),
    },
    metrics,
    overall: metrics.some((m) => m.verdict === 'FAIL') ? 'FAIL' : 'PASS',
  };
}

/**
 * Input-to-paint: grow one long live stroke a point per frame, compose with
 * onion on (as when drawing), and record time from point arrival to
 * draw-complete. This is the JS render cost per input — the dominant,
 * measurable part of input→paint on weak hardware.
 */
async function probeLatency(
  compositor: FrameCompositor,
  doc: ToonDocument,
  cfg: BenchConfig,
): Promise<number[]> {
  const raw = syntheticRawPoints(doc, 999, cfg.latencyPoints);
  const live: LiveStroke = {
    points: [],
    width: brushWidthDoc(DEFAULT_BRUSH_SIZE_LOGICAL),
    color: '#000000',
  };
  const pts = live.points as number[];
  const latencies: number[] = [];
  for (let i = 0; i < cfg.latencyPoints; i++) {
    await nextFrame();
    const t0 = performance.now();
    pts.push(raw[2 * i], raw[2 * i + 1]);
    compositor.compose(doc, 0, 0, true, live);
    latencies.push(performance.now() - t0);
  }
  return latencies;
}

/**
 * Playback fps + alloc-loop. Warm the layer cache first (one-time layer
 * construction is not steady-state cost), then loop the corpus at the target
 * rate for the window, recording frame delivery intervals and — after warm-up —
 * heap samples. Onion is off during playback, matching the editor.
 */
async function probePlayback(
  compositor: FrameCompositor,
  doc: ToonDocument,
  cfg: BenchConfig,
): Promise<{ intervals: number[]; heap: HeapSample[] }> {
  for (let f = 0; f < doc.frames.length; f++) {
    compositor.compose(doc, f, f, false, null);
  }

  const deliveries: number[] = [];
  const heap: HeapSample[] = [];
  const start = performance.now();
  const player = new LoopPlayer({
    frameCount: doc.frames.length,
    fps: cfg.targetFps,
    startFrame: 0,
    onFrame: (idx) => {
      compositor.compose(doc, idx, idx, false, null);
      const now = performance.now();
      deliveries.push(now);
      const mem = usedHeap();
      if (mem !== null && now - start >= cfg.heapWarmupMs) {
        heap.push({ t: now, bytes: mem });
      }
    },
  });

  let now = performance.now();
  while (now - start < cfg.playbackMs) {
    now = await nextFrame();
    player.tick(now);
  }

  const intervals: number[] = [];
  for (let i = 1; i < deliveries.length; i++) {
    intervals.push(deliveries[i] - deliveries[i - 1]);
  }
  return { intervals, heap };
}
