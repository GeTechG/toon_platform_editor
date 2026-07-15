/**
 * Brush stroke assembly: raw points in float document units →
 * (at commit) Lang simplification → quantization to integers,
 * exactly once.
 */

import {
  FIXED_POINT_SCALE,
  LANG_LOOK_AHEAD,
  LANG_TOLERANCE_DOC,
  MAX_STROKE_COORDS,
} from '../format/constants';
import type { Stroke } from '../format/types';
import { simplifyLang } from './simplify';

export interface BrushSettings {
  /** Width in document units (integer ≥ 1). */
  width: number;
  /** Color `#rrggbb`, lowercase. */
  color: string;
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
    this.brush = { width: brush.width, color: brush.color.toLowerCase() };
  }

  /** Raw points for the live preview (float document units). */
  get rawPoints(): readonly number[] {
    return this.#points;
  }

  /** Adds a raw point; consecutive duplicates are dropped. */
  addPoint(x: number, y: number): void {
    const n = this.#points.length;
    if (n >= 2 && this.#points[n - 2] === x && this.#points[n - 1] === y) {
      return;
    }
    this.#points.push(x, y);
  }

  /**
   * Commit: Lang simplification → quantization (round + clamp to the
   * canvas bounds) → collapsing duplicates introduced by quantization.
   * Quantized points are canonical; there is no re-quantization.
   */
  commit(docWidth: number, docHeight: number): Stroke {
    if (this.#points.length === 0) {
      throw new Error('cannot commit an empty stroke');
    }
    const simplified = simplifyLang(this.#points, LANG_LOOK_AHEAD, LANG_TOLERANCE_DOC);
    const quantized: number[] = [];
    for (let i = 0; i < simplified.length; i += 2) {
      const x = clampInt(simplified[i], docWidth);
      const y = clampInt(simplified[i + 1], docHeight);
      const n = quantized.length;
      if (n >= 2 && quantized[n - 2] === x && quantized[n - 1] === y) {
        continue;
      }
      quantized.push(x, y);
    }
    // A single stroke over the format limit (~33k retained points) is
    // truncated rather than surfaced — takes many minutes of continuous drawing
    // to hit. The actual endpoint replaces the cut tail: first/last points are
    // always preserved.
    if (quantized.length > MAX_STROKE_COORDS) {
      quantized.length = MAX_STROKE_COORDS;
      const n = quantized.length;
      const lastX = clampInt(simplified[simplified.length - 2], docWidth);
      const lastY = clampInt(simplified[simplified.length - 1], docHeight);
      if (n >= 4 && quantized[n - 4] === lastX && quantized[n - 3] === lastY) {
        quantized.length = n - 2;
      } else {
        quantized[n - 2] = lastX;
        quantized[n - 1] = lastY;
      }
    }
    return { points: quantized, width: this.brush.width, color: this.brush.color };
  }
}

function clampInt(value: number, max: number): number {
  return Math.min(max, Math.max(0, Math.round(value)));
}
