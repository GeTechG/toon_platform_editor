/**
 * Touch and hold on the stage brings the pipette (Procreate Dreams, «Colors»:
 * «Tap and hold anywhere on your Stage to invoke the eyedropper»). The finger
 * that stays put this long picks; one that travels draws or pans as ever.
 */

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
 * pixel at least as strong as the faintest of them is a colour too — the
 * tool's own when the pixel is its colour within what the rounding of a
 * faint pixel costs, and what is seen there otherwise.
 */
export function colourOfPixel(
  [r, g, b, a]: readonly number[],
  tools: readonly ToolDescriptor[],
): string | null {
  const hex = (): string => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  if (a === 255) return hex();
  const faint = tools.filter((tool) => opacityOf(tool).opacity !== undefined);
  const floor = Math.min(...faint.map((tool) => opacityOf(tool).opacity!)) * 2.55 - 2;
  if (faint.length === 0 || a < floor) return null;
  const slack = Math.ceil(255 / a) + 1;
  for (const tool of faint) {
    for (const colour of 'fill' in tool ? [tool.color, tool.fill] : 'color' in tool ? [tool.color] : []) {
      const near = [1, 3, 5].every((at, i) => Math.abs(parseInt(colour.slice(at, at + 2), 16) - [r, g, b][i]) <= slack);
      if (near) return colour;
    }
  }
  return hex();
}

/**
 * How strongly that pixel was painted, a percent for the brush: 100 for an
 * opaque one, a translucent tool's own opacity when the pixel is within a
 * rounding step of it, and what is seen there otherwise.
 */
export function opacityOfPixel(alpha: number, tools: readonly ToolDescriptor[]): number {
  if (alpha === 255) return 100;
  const seen = Math.min(99, Math.max(1, Math.round(alpha / 2.55)));
  const own = tools.map((tool) => opacityOf(tool).opacity).find((o) => o !== undefined && Math.abs(o - seen) <= 1);
  return own ?? seen;
}
