/**
 * Synthetic benchmark corpus: L layers × N frames × M strokes, built through the real
 * model path (StrokeBuilder → addStroke) so strokes pass the same Lang
 * simplification, quantization and format validation as user-drawn ones.
 *
 * Deterministic (no RNG) so runs are comparable: stroke geometry is a phase-
 * shifted sine sweep keyed by frame/stroke index. Amplitude is well above the
 * Lang tolerance, so strokes retain points instead of collapsing to a line.
 */

import { DEFAULT_BRUSH_SIZE_LOGICAL } from '../lib/format/constants';
import type { ToonDocument } from '../lib/format/types';
import { addFrame, addLayer, addStroke, createDocument } from '../lib/model/operations';
import { StrokeBuilder, brushWidthDoc } from '../lib/tools/stroke-builder';
import { laySmoothPoints } from '../lib/render/smoothing';

export interface CorpusOptions {
  /** L — layers in the corpus. Default 1 (Multator class); 5 is the Toonio profile. */
  layers?: number;
  frames: number;
  strokesPerFrame: number;
  pointsPerStroke: number;
  /** Every Nth stroke is laid down by the Tonio brush; 0 keeps the corpus Multator-only. */
  mixedEvery?: number;
}

// A few valid #rrggbb colors, cycled so the corpus exercises strokeStyle churn.
const PALETTE = ['#000000', '#3355cc', '#cc3355', '#22aa44', '#aa7711'];

export function buildCorpus(opts: CorpusOptions): ToonDocument {
  const doc = createDocument();
  const layerCount = opts.layers ?? 1;
  const width = brushWidthDoc(DEFAULT_BRUSH_SIZE_LOGICAL);
  for (let f = 0; f < opts.frames; f++) {
    if (f > 0) addFrame(doc, f - 1);
  }
  for (let l = 1; l < layerCount; l++) {
    addLayer(doc, l);
  }
  for (let l = 0; l < layerCount; l++) {
    for (let f = 0; f < opts.frames; f++) {
      for (let s = 0; s < opts.strokesPerFrame; s++) {
        const color = PALETTE[(f + s + l) % PALETTE.length];
        // Seeded by layer too, so layers do not draw identical geometry.
        const stroke = syntheticStroke(doc, f + l * opts.frames, s, opts.pointsPerStroke, width, color);
        if (opts.mixedEvery && (f * opts.strokesPerFrame + s) % opts.mixedEvery === 0) {
          const last = stroke.points.slice(-2);
          addStroke(doc, l, f, {
            // Laid down the way the Tonio brush lays a line: its endpoint
            // sentinel, and its first point repeated for the phase.
            points: laySmoothPoints([...stroke.points, ...last]),
            tool: { kind: 'pencil', geometry: 'smooth', width, color },
          });
        } else {
          addStroke(doc, l, f, stroke);
        }
      }
    }
  }
  return doc;
}

/** Builds one live-stroke's worth of raw float points across the canvas. */
export function syntheticRawPoints(
  doc: ToonDocument,
  seed: number,
  count: number,
): number[] {
  const pts: number[] = [];
  const w = doc.width;
  const h = doc.height;
  const phase = seed * 0.37;
  const amp = h * 0.35;
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0;
    const x = t * w;
    const y = h / 2 + Math.sin(t * Math.PI * 3 + phase) * amp * Math.cos(phase * 0.5);
    pts.push(x, y);
  }
  return pts;
}

function syntheticStroke(
  doc: ToonDocument,
  frame: number,
  stroke: number,
  count: number,
  width: number,
  color: string,
) {
  const builder = new StrokeBuilder({ width, color });
  const raw = syntheticRawPoints(doc, frame * 31 + stroke, count);
  for (let i = 0; i < raw.length; i += 2) {
    builder.addPoint(raw[i], raw[i + 1]);
  }
  return builder.commit();
}
