/**
 * Distort (~), the first tool to go through the plugin contract.
 *
 * It is here rather than in the register's table because it uses the whole
 * contract at once — a gesture, a write to the document and one step of undo.
 * A contract it did not fit would be the wrong contract.
 *
 * Not a session but a destructive brush (`tools.js` `Distort`): horizontal
 * travel sets a strength, and every point of the frame gets a random kick of
 * that size on every accepted move.
 */

import { FIXED_POINT_SCALE } from '../format/constants';
import { distortRate, jitter } from '../tools/distort';
import type { PluginHost, PluginTool } from './contract';

/** The reference writes once every this many logical pixels. */
const STEP_PX = 5;

/** Logical pixels per document unit — a constant of the format, not of a canvas. */
const PX_PER_UNIT = 1 / FIXED_POINT_SCALE;

/** The live drag; one gesture runs at a time, so it can live here. */
let drag: { startX: number; lastStep: number } | null = null;

export const distortTool: PluginTool = {
  icon: 'jitter',
  title: 'Дрожь (~) — дребезг штрихов кадра',
  label: 'Дрожь',
  key: '~',
  help: true,
  cursor: 'e-resize',

  press(_host: PluginHost, point) {
    drag = { startX: point.x, lastStep: NaN };
  },

  /**
   * Everything here is measured in logical pixels — the strength, and the
   * every-fifth-pixel throttle (`~~x % 5`). Counting either in document
   * units shakes the frame several times too often.
   */
  move(host: PluginHost, point) {
    if (!drag) {
      return;
    }
    const perDocUnit = PX_PER_UNIT;
    const referenceX = point.x * perDocUnit;
    const step = Math.trunc(referenceX / STEP_PX);
    if (step === drag.lastStep) {
      return;
    }
    drag.lastStep = step;
    const rate = distortRate(referenceX, drag.startX * perDocUnit) / perDocUnit;
    if (rate === 0) {
      return;
    }
    host.edit((strokes) => {
      for (const stroke of strokes) {
        stroke.points = jitter(stroke.points, rate);
      }
    });
  },

  release() {
    drag = null;
  },
};
