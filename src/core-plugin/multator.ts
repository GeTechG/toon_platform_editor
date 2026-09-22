/**
 * The Multator brush's own rules.
 *
 * Everything the editor used to know about the Multator line lives here: how
 * the pointer's points are collected, and how they are thinned when the
 * gesture ends. The engine takes these as plain functions and never learns
 * whose they are.
 */

import {
  CANVAS_LOGICAL_WIDTH,
  FIXED_POINT_SCALE,
  LANG_LOOK_AHEAD,
  LANG_TOLERANCE_LOGICAL,
  MAX_STROKE_COORDS,
  STROKE_COORD_MAX,
  STROKE_COORD_MIN,
} from '../lib/format/constants';
import { simplifyLang } from '../lib/tools/simplify';
import type { StrokeRules } from '../lib/plugins/contract';

/** Native width of the source Multator drawing canvas. */
const MULTATOR_CANVAS_WIDTH = 600;

/**
 * What a number of the reference is worth here. Its canvas was 600 wide and
 * the editor's is 1280, so every pixel it measured is 2.13(3) of ours — a
 * reference "1" was never one pixel of this editor. The numbers below are the
 * reference's own, multiplied by this and rounded where the slider shows them.
 */
export const MULTATOR_SCALE = CANVAS_LOGICAL_WIDTH / MULTATOR_CANVAS_WIDTH;

/** The reference's Lang tolerance (10 px of its canvas), in document units. */
const LANG_TOLERANCE_DOC = LANG_TOLERANCE_LOGICAL * MULTATOR_SCALE * FIXED_POINT_SCALE;

export const MULTATOR_RULES: StrokeRules = {
  // The reference's row of dots goes to 300 — 640 here — and neither of its
  // two numbers reaches this brush: Lang thins it, not the smoothing pair.
  range: { min: 1, max: Math.round(300 * MULTATOR_SCALE) },
  defaults: { width: Math.round(4 * MULTATOR_SCALE), smooth: 3, minDistance: 3 },
  smoothing: false,
  // One point per event, repeats and all: the reference pushes every mousemove
  // as it comes, and a trailing repeat changes both the Lang window and the
  // last curve segment. The samples a browser coalesced between frames are not
  // events the reference ever saw, so only the last pair — the event itself —
  // joins the line.
  capture: (_line, batch) =>
    batch.length < 2 ? [] : [batch[batch.length - 2], batch[batch.length - 1]],
  // The tolerance is document units like every other number here: the size
  // of the document it lands on does not enter into it.
  prepare: (points) => quantize(simplifyLang(points, LANG_LOOK_AHEAD, LANG_TOLERANCE_DOC)),
  // The reference shows the raw polyline while the hand is down and curves it
  // only on release, so the line under the hand is read as a polyline.
  previewGeometry: 'line',
  // The release contributes its point like any other event, unless the hand
  // never moved and let go where it pressed — that stays a dot.
  release: (line, batch, width) =>
    line.length === 2 && line[0] === batch[batch.length - 2] && line[1] === batch[batch.length - 1]
      ? []
      : MULTATOR_RULES.capture(line, batch, width),
};

/**
 * Round and clamp to the int16 storage range; points may lie outside the
 * canvas. Quantized points are canonical — nothing re-quantizes them later.
 *
 * A single stroke over the format limit is truncated rather than surfaced —
 * it takes many minutes of continuous drawing to hit. The actual endpoint
 * replaces the cut tail: the first and last points always survive.
 */
function quantize(simplified: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < simplified.length; i += 2) {
    out.push(clampInt(simplified[i]), clampInt(simplified[i + 1]));
  }
  if (out.length > MAX_STROKE_COORDS) {
    out.length = MAX_STROKE_COORDS;
    const n = out.length;
    const lastX = clampInt(simplified[simplified.length - 2]);
    const lastY = clampInt(simplified[simplified.length - 1]);
    if (n >= 4 && out[n - 4] === lastX && out[n - 3] === lastY) {
      out.length = n - 2;
    } else {
      out[n - 2] = lastX;
      out[n - 1] = lastY;
    }
  }
  return out;
}

function clampInt(value: number): number {
  return Math.min(STROKE_COORD_MAX, Math.max(STROKE_COORD_MIN, Math.round(value)));
}
