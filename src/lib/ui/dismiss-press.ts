/**
 * A tap that closes a popup only closes it (owner, 2026-10-08). A press
 * outside an open box — a key's box, «⋯», the sound's plate, a frame's menu —
 * closes it and goes on to the sheet: a stroke begun there draws from its
 * first point, but a tap left a dot of the brush in hand nobody meant.
 *
 * What closes a popup tells of the press here; the sheet asks at the release.
 * Kept by the press itself, not by its pointer: the mouse is pointer 1 every
 * time, and the click after the one that closed a box is a dot again. Told and
 * asked within one press, so the closer may hear it after the sheet did.
 */

import { pastDragThreshold } from './draggable';

let closing: Event | null = null;

/** The press that has just closed a popup. */
export function notePopupClosed(press: Event): void {
  closing = press;
}

/** Whether this press closed a popup. */
export function closedAPopup(press: Event | null): boolean {
  return press !== null && press === closing;
}

/** Whether the press closed a popup and ended where it began: nothing is drawn by it. */
export function dismissedOnly(press: Event | null, travel: { dx: number; dy: number }, pointerType: string): boolean {
  return closedAPopup(press) && !pastDragThreshold(travel.dx, travel.dy, pointerType);
}
