/**
 * Brush stroke assembly: raw points in float document units →
 * (at commit) Lang simplification → quantization to integers,
 * exactly once.
 */
import type { BuiltStroke } from '../model/operations';

import {
  FIXED_POINT_SCALE,
  LANG_LOOK_AHEAD,
  LANG_TOLERANCE_DOC,
  MAX_STROKE_COORDS,
  STROKE_COORD_MAX,
  STROKE_COORD_MIN,
} from '../format/constants';

import { simplifyLang } from './simplify';

export interface BrushSettings {
  /** Width in document units (integer ≥ 1). */
  width: number;
  /** Color `#rrggbb`, lowercase. */
  color: string;
  /** When true, the stroke erases instead of painting. */
  erase?: boolean;
}

/** Brush width in document units from the logical size (canvas px). */
export function brushWidthDoc(sizeLogical: number): number {
  return Math.max(1, Math.round(sizeLogical * FIXED_POINT_SCALE));
}

export class StrokeBuilder {
  readonly brush: BrushSettings;
  #points: number[] = [];

  /** Brush attributes are fixed at stroke start (copied). */
  constructor(brush: BrushSettings) {
    this.brush = { width: brush.width, color: brush.color.toLowerCase(), erase: brush.erase };
  }

  /** Raw points for the live preview (float document units). */
  get rawPoints(): readonly number[] {
    return this.#points;
  }

  /**
   * Adds a raw point. A repeat is kept: the reference pushes every mousemove
   * and the mouseup as they come, and a trailing repeat changes both the
   * Lang window and the last curve segment.
   */
  addPoint(x: number, y: number): void {
    this.#points.push(x, y);
  }

  /**
   * Commit: Lang simplification → quantization (round + clamp to the
   * int16 storage range; points may lie outside the canvas). Quantized
   * points are canonical; there is no re-quantization. Repeats survive: the
   * reference stores them, and `[…, X, P, P]` curves through the midpoint of
   * X–P where `[…, X, P]` would not.
   *
   * `tolerance` is the Lang tolerance in document units — the reference's
   * 10 px of its 600 px canvas, scaled to the document by the caller.
   */
  commit(tolerance = LANG_TOLERANCE_DOC): BuiltStroke {
    if (this.#points.length === 0) {
      throw new Error('cannot commit an empty stroke');
    }
    const simplified = simplifyLang(this.#points, LANG_LOOK_AHEAD, tolerance);
    const quantized: number[] = [];
    for (let i = 0; i < simplified.length; i += 2) {
      quantized.push(clampInt(simplified[i]), clampInt(simplified[i + 1]));
    }
    // A single stroke over the format limit (~33k retained points) is
    // truncated rather than surfaced — takes many minutes of continuous drawing
    // to hit. The actual endpoint replaces the cut tail: first/last points are
    // always preserved.
    if (quantized.length > MAX_STROKE_COORDS) {
      quantized.length = MAX_STROKE_COORDS;
      const n = quantized.length;
      const lastX = clampInt(simplified[simplified.length - 2]);
      const lastY = clampInt(simplified[simplified.length - 1]);
      if (n >= 4 && quantized[n - 4] === lastX && quantized[n - 3] === lastY) {
        quantized.length = n - 2;
      } else {
        quantized[n - 2] = lastX;
        quantized[n - 1] = lastY;
      }
    }
    const stroke: BuiltStroke = { points: quantized, width: this.brush.width, color: this.brush.color };
    if (this.brush.erase) {
      stroke.erase = true;
    }
    return stroke;
  }
}

function clampInt(value: number): number {
  return Math.min(STROKE_COORD_MAX, Math.max(STROKE_COORD_MIN, Math.round(value)));
}
