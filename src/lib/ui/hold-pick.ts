/**
 * Touch and hold on the stage brings the pipette (Procreate Dreams, «Colors»:
 * «Tap and hold anywhere on your Stage to invoke the eyedropper»). The finger
 * that stays put this long picks; one that travels draws or pans as ever.
 */

import { BACKGROUND_COLOR } from '../format/constants';
import { opacityOf, type ToolDescriptor } from '../format/types';

/** The timeline's long press: one hold, one length, across the studio. */
export const HOLD_PICK_MS = 500;
/** How far a still finger may shiver, CSS px. */
export const HOLD_SLOP_PX = 10;

export function stillHeld(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) <= HOLD_SLOP_PX;
}

export interface HoldPress {
  pointerType: string;
  isPrimary: boolean;
  /** Fingers already on the glass before this one. */
  fingers: number;
  playing: boolean;
  transform: boolean;
  tool: string;
  /** The tool brought its own drag (plugins/contract.ts `press`). */
  ownGesture: boolean;
  onSheet: boolean;
  penBusy: boolean;
}

/**
 * Only the first finger, on the sheet, under a tool that draws or pans. A pen
 * held still draws a dot; the lasso, a transform and a tool's own drag keep
 * the finger for themselves; the pipette already is one.
 */
export function mayHoldPick(p: HoldPress): boolean {
  return p.pointerType === 'touch' && p.isPrimary && p.fingers === 0 && !p.penBusy
    && !p.playing && !p.transform && !p.ownGesture && p.onSheet
    && p.tool !== 'pipette' && p.tool !== 'lasso' && p.tool !== 'loop';
}

/**
 * The colour of a pixel of the frame, `[r, g, b, a]` as the canvas hands it
 * back, or null for emptiness. Only an opaque pixel carried a colour while
 * every line was opaque: the soft rim of a stroke reads as emptiness. A
 * translucent line is never opaque, so where the drawing holds such tools a
 * pixel at least as strong as the faintest of them is a colour too — the one
 * it is seen as on the paper, opaque: the brush that takes it paints what
 * the eye picked, at whatever opacity the brush is set to.
 */
export function colourOfPixel(
  [r, g, b, a]: readonly number[],
  tools: readonly ToolDescriptor[],
  paper = BACKGROUND_COLOR,
): string | null {
  const hex = (rgb: readonly number[]): string => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
  if (a === 255) return hex([r, g, b]);
  const faint = tools.flatMap((tool) => opacityOf(tool).opacity ?? []);
  if (faint.length === 0 || a < Math.min(...faint) * 2.55 - 2) return null;
  return hex([r, g, b].map((v, i) => Math.round((v * a + parseInt(paper.slice(1 + 2 * i, 3 + 2 * i), 16) * (255 - a)) / 255)));
}
