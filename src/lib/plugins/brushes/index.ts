/**
 * The brushes a preset may pick, by id.
 *
 * A preset names a brush rather than a canvas or an algorithm, and the brush
 * brings its own rules. The table exists so nothing has to branch on which
 * brush that is — adding one is a line here, not a condition somewhere.
 */

import type { StrokeRules } from '../contract';
import { MULTATOR_RULES } from './multator';
import { toonioRules, type ToonioTuning } from './toonio';

export type BrushId = 'multator' | 'toonio';

export const PRESET_BRUSHES: Readonly<Record<BrushId, (tuning: ToonioTuning) => StrokeRules>> = {
  multator: () => MULTATOR_RULES,
  toonio: (tuning) => toonioRules(tuning),
};

/** The rules of the brush a preset picked, tuned by what the editor holds. */
export function presetBrushRules(id: BrushId, tuning: ToonioTuning): StrokeRules {
  return (PRESET_BRUSHES[id] ?? PRESET_BRUSHES.multator)(tuning);
}

/**
 * Which settings bucket a canvas belongs to. The editor keeps a brush's width
 * and thresholds per canvas, because a pixel of one is not a pixel of the
 * other; a brush on some third canvas falls back to the preset's bucket.
 */
export function brushIdForCanvas(canvas: number, fallback: BrushId): BrushId {
  for (const id of Object.keys(PRESET_BRUSHES) as BrushId[]) {
    if (PRESET_BRUSHES[id]({ smooth: 1, minDistance: 0 }).canvas === canvas) {
      return id;
    }
  }
  return fallback;
}
