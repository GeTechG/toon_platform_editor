/**
 * Touch and hold on the stage brings the pipette (Procreate Dreams, «Colors»:
 * «Tap and hold anywhere on your Stage to invoke the eyedropper»). The finger
 * that stays put this long picks; one that travels draws or pans as ever.
 */

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
    && p.tool !== 'pipette' && p.tool !== 'lasso';
}
