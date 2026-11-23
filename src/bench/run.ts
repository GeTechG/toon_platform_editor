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
import { CELL_CACHE_BYTES, type LiveLine } from '../lib/render/frame-compose';
import { Canvas2DSheetComposer, type SheetComposer } from '../lib/render/sheet-composer';
import { acquireStudioWebGL2, type RenderBackendReason } from '../lib/render/webgl/probe';
import { WebGL2SheetComposer } from '../lib/render/webgl/composer';
import { studioVramBudget } from '../lib/render/webgl/vram-budget';
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
  actualBackend: 'canvas2d' | 'webgl2';
  backendFallbackReason?: RenderBackendReason;
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
class WebGL2BenchFallbackError extends Error {
  constructor(readonly reason: RenderBackendReason) {
    super(`WebGL2 benchmark fallback: ${reason}`);
  }
}

class BenchCanvas {
  readonly #composer: SheetComposer;
  readonly #glComposer: WebGL2SheetComposer | null = null;
  readonly #glCanvas: HTMLCanvasElement | null = null;
  readonly #glContext: WebGL2RenderingContext | null = null;
  readonly #origDisplay: string;
  readonly actualBackend: 'canvas2d' | 'webgl2';
  readonly fallbackReason?: RenderBackendReason;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    backend: 'canvas2d' | 'webgl2' = 'canvas2d',
    fallbackReason?: RenderBackendReason,
  ) {
    this.#origDisplay = canvas.style.display;
    this.fallbackReason = fallbackReason;
    if (backend === 'webgl2') {
      // Probe WebGL2 on a dedicated sibling canvas so a rejected WebGL2 context
      // never locks the primary `canvas` out of `getContext('2d')`. When valid,
      // mount and display it in place of `canvas` so browser presentation is timed fairly.
      const candidate = document.createElement('canvas');
      candidate.width = canvas.width;
      candidate.height = canvas.height;
      candidate.style.width = canvas.style.width;
      candidate.style.height = canvas.style.height;
      candidate.className = canvas.className;
      const acquired = acquireStudioWebGL2(candidate, Math.max(2048, canvas.width, canvas.height));
      if (acquired.gl && acquired.capability.webgl2Eligible && acquired.capability.fboFormats) {
        this.#glCanvas = candidate;
        this.#glContext = acquired.gl;
        if (canvas.parentNode) {
          canvas.style.display = 'none';
          canvas.parentNode.insertBefore(candidate, canvas);
        }
        const maxTex = Number(acquired.gl.getParameter(acquired.gl.MAX_TEXTURE_SIZE)) || 0;
        const glComp = new WebGL2SheetComposer(acquired.gl, {
          formats: acquired.capability.fboFormats,
          budgetBytes: studioVramBudget({
            deviceMemory: typeof navigator === 'undefined' ? undefined : (navigator as { deviceMemory?: number }).deviceMemory,
            maxTextureSize: maxTex,
            coarsePointer: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
          }),
        });
        this.#glComposer = glComp;
        this.#composer = glComp;
        this.actualBackend = 'webgl2';
        return;
      }
      candidate.width = 0;
      candidate.height = 0;
      this.fallbackReason = acquired.capability.reason;
    }
    if (!canvas.getContext('2d')) {
      throw new Error('2D context unavailable');
    }
    this.#composer = new Canvas2DSheetComposer(canvas, { cellBytes: CELL_CACHE_BYTES });
    this.actualBackend = 'canvas2d';
  }

  compose(doc: ToonDocument, frame: number, onion: boolean, live: LiveLine | null): void {
    const { width, height } = this.canvas;
    // dpr folded into the pixel count: k = scale × dpr = width / doc.width.
    const viewport = { scale: width / doc.width, dpr: 1 };
    const scene = {
      doc,
      frame,
      activeLayer: 0,
      viewport,
      tools: doc.tools,
      ghosts: onion
        ? { frames: onionLayers(frame, frameCount(doc), ONION_SKIN_ALPHAS), layers: [0] }
        : undefined,
      live,
      paper: BACKGROUND_COLOR,
    };
    const ok = this.#composer.composeAndPresent(width, height, scene, {
      stageWidth: width,
      stageHeight: height,
      sheetX: 0,
      sheetY: 0,
      sheetW: width,
      sheetH: height,
      angle: 0,
      stretch: 1,
      paper: BACKGROUND_COLOR,
      gridStep: 0,
    });
    if (!ok) {
      if (this.#glComposer) {
        throw new WebGL2BenchFallbackError(this.#glComposer.lastFailure ?? 'context-lost');
      }
      throw new Error(`Benchmark render failed on ${this.actualBackend} backend`);
    }
  }

  /** The frame changed: the stack the composer holds is stale. */
  invalidate(): void {
    this.#composer.invalidate();
  }

  dispose(): void {
    this.#composer.dispose();
    try {
      this.#glContext?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      // Context already lost.
    }
    if (this.#glCanvas) {
      this.#glCanvas.remove();
      this.#glCanvas.width = 0;
      this.#glCanvas.height = 0;
      this.canvas.style.display = this.#origDisplay;
    }
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
  const measure = async (
    backend: 'canvas2d' | 'webgl2',
    fallbackReason?: RenderBackendReason,
  ): Promise<{
    actualBackend: 'canvas2d' | 'webgl2';
    fallbackReason?: RenderBackendReason;
    latencies: number[];
    intervals: number[];
    heap: HeapSample[];
  }> => {
    const compositor = new BenchCanvas(canvas, backend, fallbackReason);
    try {
      const latencies = await probeLatency(compositor, doc, cfg);
      const { intervals, heap } = await probePlayback(compositor, doc, cfg);
      return {
        actualBackend: compositor.actualBackend,
        fallbackReason: compositor.fallbackReason,
        latencies,
        intervals,
        heap,
      };
    } finally {
      compositor.dispose();
    }
  };

  let measured: Awaited<ReturnType<typeof measure>>;
  try {
    measured = await measure(cfg.backend);
  } catch (err) {
    if (err instanceof WebGL2BenchFallbackError) {
      // WebGL2 failed mid-run (e.g. budget rejection or context loss): restart cleanly on Canvas 2D.
      measured = await measure('canvas2d', err.reason);
    } else {
      throw err;
    }
  }
  const { actualBackend, fallbackReason, latencies, intervals, heap } = measured;

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
    actualBackend,
    backendFallbackReason: fallbackReason,
    corpus: {
      layers: doc.layers.length,
      frames: frameCount(doc),
      strokesPerFrame: cfg.strokesPerFrame,
      totalStrokes: doc.layers.reduce(
        (n, layer) => n + layer.frames.reduce((m, cell) => m + (cell?.strokes.length ?? 0), 0),
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
