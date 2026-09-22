/**
 * Browser drivers: exercise the real render path over the synthetic corpus and
 * turn raw samples into pass/fail metrics. Runs only in a browser (rAF,
 * performance.now, canvas). The pure math lives in metrics.ts.
 */

import { BACKGROUND_COLOR, DEFAULT_BRUSH_SIZE_LOGICAL, ONION_SKIN_ALPHAS } from '../lib/format/constants';
import type { ToonDocument } from '../lib/format/types';
import { LoopPlayer } from '../lib/player/player';
import { brushWidthDoc } from '../lib/tools/stroke-builder';
import type { BenchConfig } from './config';
import { FrameComposer, type ComposeTarget, type LiveLine } from '../lib/render/frame-compose';
import { onionLayers } from '../lib/ui/frame-selection';
import { frameCount } from '../lib/model/operations';
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
  corpus: { layers: number; frames: number; strokesPerFrame: number; totalStrokes: number };
  metrics: MetricResult[];
  overall: 'PASS' | 'FAIL';
}

const nextFrame = (): Promise<number> => new Promise((r) => requestAnimationFrame(r));

function usedHeap(): number | null {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? mem.usedJSHeapSize : null;
}

/**
 * The frame, drawn the way the editor draws it: the same composer, the same
 * buffers, the same live line. What the editor puts over it — the paper, the
 * clip to the sheet, a tool's grid — is not the frame and is not measured.
 */
class BenchCanvas {
  readonly #ctx: ComposeTarget;
  readonly #composer = new FrameComposer();

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D context unavailable');
    }
    this.#ctx = ctx as unknown as ComposeTarget;
  }

  compose(doc: ToonDocument, frame: number, onion: boolean, live: LiveLine | null): void {
    const { width, height } = this.canvas;
    // dpr folded into the pixel count: k = scale × dpr = width / doc.width.
    const viewport = { scale: width / doc.width, dpr: 1 };
    this.#ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.#ctx.fillStyle = BACKGROUND_COLOR;
    this.#ctx.fillRect(0, 0, width, height);
    this.#composer.compose(this.#ctx, width, height, {
      doc,
      frame,
      activeLayer: 0,
      viewport,
      tools: doc.tools,
      ghosts: onion
        ? { frames: onionLayers(frame, frameCount(doc), ONION_SKIN_ALPHAS), layers: [0] }
        : undefined,
      live,
    });
  }

  /** The frame changed: the stack the composer holds is stale. */
  invalidate(): void {
    this.#composer.invalidate();
  }
}

export async function runBench(canvas: HTMLCanvasElement, cfg: BenchConfig): Promise<BenchResult> {
  const doc = buildCorpus({
    layers: cfg.layers,
    frames: cfg.frames,
    strokesPerFrame: cfg.strokesPerFrame,
    pointsPerStroke: cfg.pointsPerStroke,
    mixedEvery: cfg.mixedEvery,
  });
  const compositor = new BenchCanvas(canvas);

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
      layers: doc.layers.length,
      frames: frameCount(doc),
      strokesPerFrame: cfg.strokesPerFrame,
      totalStrokes: doc.layers.reduce(
        (n, layer) => n + layer.frames.reduce((m, cell) => m + cell.strokes.length, 0),
        0,
      ),
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
  compositor: BenchCanvas,
  doc: ToonDocument,
  cfg: BenchConfig,
): Promise<number[]> {
  const raw = syntheticRawPoints(doc, 999, cfg.latencyPoints);
  const points: number[] = [];
  const live: LiveLine = {
    id: 1,
    points,
    geometry: 'smooth',
    width: brushWidthDoc(DEFAULT_BRUSH_SIZE_LOGICAL),
    color: '#000000',
  };
  const latencies: number[] = [];
  for (let i = 0; i < cfg.latencyPoints; i++) {
    await nextFrame();
    const t0 = performance.now();
    points.push(raw[2 * i], raw[2 * i + 1]);
    compositor.compose(doc, 0, true, live);
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
  compositor: BenchCanvas,
  doc: ToonDocument,
  cfg: BenchConfig,
): Promise<{ intervals: number[]; heap: HeapSample[] }> {
  for (let f = 0; f < frameCount(doc); f++) {
    compositor.invalidate();
    compositor.compose(doc, f, false, null);
  }

  const deliveries: number[] = [];
  const heap: HeapSample[] = [];
  const start = performance.now();
  const player = new LoopPlayer({
    frameCount: frameCount(doc),
    fps: cfg.targetFps,
    startFrame: 0,
    onFrame: (idx) => {
      // A frame of playback is a new frame: the stack the composer holds is
      // the frame it drew last, exactly as in the editor.
      compositor.invalidate();
      compositor.compose(doc, idx, false, null);
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
