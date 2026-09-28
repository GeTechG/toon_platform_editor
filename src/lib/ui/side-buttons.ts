/**
 * The mouse's side buttons (4 and 5 — `button` 3 and 4) draw on the canvas
 * like any other, but the browser takes their release for «back» and
 * «forward» and leaves the studio mid-stroke (owner, after the fourteenth
 * audit). A press that began on the canvas arms the guard; its release —
 * pointerup, mouseup and the auxclick after it, wherever the pointer is by
 * then — has its default taken away. A side button pressed anywhere else
 * still walks the history as it always has.
 */

/** `MouseEvent.button` of the back and forward buttons. */
const HISTORY_BUTTONS = new Set([3, 4]);

export interface SideButtonGuard {
  /** A button pressed on the canvas. */
  press(button: number): void;
  /** A release anywhere in the window, heard before anyone else (capture). */
  release(e: { type: string; button: number; preventDefault(): void }): void;
}

/**
 * `later` runs after the release's task: the auxclick comes in the same task
 * as the mouseup, so the guard stays up for it and comes down right after.
 */
export function createSideButtonGuard(
  later: (run: () => void) => void = (run) => setTimeout(run, 0),
): SideButtonGuard {
  let armed = false;
  return {
    press(button) {
      if (HISTORY_BUTTONS.has(button)) {
        armed = true;
      }
    },
    release(e) {
      if (!armed || !HISTORY_BUTTONS.has(e.button)) {
        return;
      }
      e.preventDefault();
      if (e.type === 'mouseup') {
        later(() => {
          armed = false;
        });
      }
    },
  };
}
