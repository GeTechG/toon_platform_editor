/**
 * Synthetic benchmark corpus: N frames × M strokes, built through the real
 * model path (StrokeBuilder → addStroke) so strokes pass the same Lang
 * simplification, quantization and format validation as user-drawn ones.
 *
 * Deterministic (no RNG) so runs are comparable: stroke geometry is a phase-
 * shifted sine sweep keyed by frame/stroke index. Amplitude is well above the
 * Lang tolerance, so strokes retain points instead of collapsing to a line.
 */

import { DEFAULT_BRUSH_SIZE_LOGICAL } from '../lib/format/constants';
import type { ToonDocument } from '../lib/format/types';
import { addFrame, addStroke, createDocument } from '../lib/model/operations';
import { StrokeBuilder, brushWidthDoc } from '../lib/tools/stroke-builder';

export interface CorpusOptions {
  frames: number;
  strokesPerFrame: number;
  pointsPerStroke: number;
  /** Every Nth stroke uses Tonio geometry; 0 keeps the corpus Multator-only. */
  mixedEvery?: number;
}

// A few valid #rrggbb colors, cycled so the corpus exercises strokeStyle churn.
const PALETTE = ['#000000', '#3355cc', '#cc3355', '#22aa44', '#aa7711'];

export function buildCorpus(opts: CorpusOptions): ToonDocument {
  const doc = createDocument();
  const width = brushWidthDoc(DEFAULT_BRUSH_SIZE_LOGICAL);
  for (let f = 0; f < opts.frames; f++) {
    const frameIndex = f === 0 ? 0 : addFrame(doc, f - 1);
    for (let s = 0; s < opts.strokesPerFrame; s++) {
      const color = PALETTE[(f + s) % PALETTE.length];
      const stroke = syntheticStroke(doc, f, s, opts.pointsPerStroke, width, color);
      if (opts.mixedEvery && (f * opts.strokesPerFrame + s) % opts.mixedEvery === 0) {
        const last = stroke.points.slice(-2);
        addStroke(doc, frameIndex, {
          points: [...stroke.points, ...last],
          tool: { kind: 'pencil', dialect: 'toonio', width, color },
        });
      } else {
        addStroke(doc, frameIndex, stroke);
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
