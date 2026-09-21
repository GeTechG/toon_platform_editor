/**
 * The Multator brush's own rules.
 *
 * Everything the editor used to know about the Multator canvas lives here:
 * the canvas its width is measured on, how the pointer's points are collected,
 * and how they are thinned when the gesture ends. The engine takes these as
 * plain functions and never learns whose they are.
 */

import {
  LANG_LOOK_AHEAD,
  LANG_TOLERANCE_DOC,
  MAX_STROKE_COORDS,
  STROKE_COORD_MAX,
  STROKE_COORD_MIN,
} from '../../format/constants';
import { simplifyLang } from '../../tools/simplify';
import type { StrokeRules } from '../contract';

/** Native width of the source Multator drawing canvas. */
export const MULTATOR_CANVAS_WIDTH = 600;

export const MULTATOR_RULES: StrokeRules = {
  canvas: MULTATOR_CANVAS_WIDTH,
  // One point per event, repeats and all: the reference pushes every mousemove
  // as it comes, and a trailing repeat changes both the Lang window and the
  // last curve segment. The samples a browser coalesced between frames are not
  // events the reference ever saw, so only the last pair — the event itself —
  // joins the line.
  capture: (line, batch) =>
    batch.length < 2 ? [...line] : [...line, batch[batch.length - 2], batch[batch.length - 1]],
  // The reference measures its Lang tolerance on its own 600 px canvas, so on
  // a document of another size it scales the way the width does.
  prepare: (points, _width, _zoom, canvasScale) =>
    quantize(simplifyLang(points, LANG_LOOK_AHEAD, LANG_TOLERANCE_DOC / canvasScale)),
  // The reference shows the raw polyline while the hand is down and curves it
  // only on release, so the line under the hand is read as a polyline.
  previewGeometry: 'line',
  // The release contributes its point like any other event, unless the hand
  // never moved and let go where it pressed — that stays a dot.
  release: (line, batch, width) =>
    line.length === 2 && line[0] === batch[batch.length - 2] && line[1] === batch[batch.length - 1]
      ? [...line]
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
