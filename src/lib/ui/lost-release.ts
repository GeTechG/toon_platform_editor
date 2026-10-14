/**
 * A mouse or a pen moving with no button held has let go where its release
 * never came (a menu, a native dialog, another window): the drag ends, or it
 * rides the bare hover. A finger has no hover — its moves are always pressed.
 *
 * But Firefox on Windows sends a Wacom pen's light line one move with no
 * buttons while the tip stays down (owner, 2026-10-14). A pen counts as let
 * go only on the second blank move running: a lost release hovers on and on.
 */
export interface LostRelease {
  (e: { pointerType: string; buttons: number }, released?: (buttons: number) => boolean): boolean;
  /** A new drag: a blank move left over from the last one does not count. */
  reset(): void;
}

export function createLostRelease(): LostRelease {
  let blank = false;
  const lost = ((e, released = (buttons) => buttons === 0) => {
    if (e.pointerType === 'touch' || !released(e.buttons)) {
      blank = false;
      return false;
    }
    if (e.pointerType === 'pen' && !blank) {
      blank = true;
      return false;
    }
    blank = false;
    return true;
  }) as LostRelease;
  lost.reset = () => {
    blank = false;
  };
  return lost;
}

/** For a drag held by the main button alone: it is let go when that one is. */
export const mainUp = (buttons: number): boolean => (buttons & 1) === 0;
