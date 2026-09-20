/**
 * The reference's floating tool windows (zoom, transform) are dragged by
 * their title bar — or, where they are a single row of keys, by their whole
 * body — and never leave the page. One action serves both: it moves the
 * element it is put on, started from anything marked `data-drag-handle`.
 *
 * A press on a key stays a press: the window only leaves the flow once the
 * pointer has travelled `DRAG_THRESHOLD`, and from then on the pointer
 * capture keeps the press from landing on the key as a click.
 *
 * The window goes `position: fixed` while dragged, so no ancestor of it may
 * carry a `filter`, `transform` or `perspective`: any of those becomes the
 * containing block of a fixed child and the window jumps off the screen.
 */

/** CSS pixels of travel that turn a press into a drag. */
const DRAG_THRESHOLD = 4;

export interface Size {
  width: number;
  height: number;
}

/** Keeps a window inside the page; one larger than the page sits in the corner. */
export function clampWindowPosition(
  left: number,
  top: number,
  size: Size,
  bounds: Size,
): { left: number; top: number } {
  return {
    left: Math.max(0, Math.min(left, bounds.width - size.width)),
    top: Math.max(0, Math.min(top, bounds.height - size.height)),
  };
}

interface Grab {
  x: number;
  y: number;
  left: number;
  top: number;
  handle: HTMLElement;
  pointerId: number;
  /** The press has travelled far enough to be a drag. */
  moving: boolean;
}

export function draggable(node: HTMLElement): { destroy(): void } {
  let grab: Grab | null = null;

  function onPointerDown(e: PointerEvent): void {
    const handle = (e.target as HTMLElement | null)?.closest('[data-drag-handle]');
    if (e.button !== 0 || !handle || !node.contains(handle)) {
      return;
    }
    const rect = node.getBoundingClientRect();
    grab = {
      x: e.clientX,
      y: e.clientY,
      left: rect.left,
      top: rect.top,
      handle: handle as HTMLElement,
      pointerId: e.pointerId,
      moving: false,
    };
    // Until the press becomes a drag there is no pointer capture — a key must
    // still take its click — so the moves are followed on the window, or a
    // quick drag off a 120px window would never reach the node at all.
    watch(true);
  }

  function watch(on: boolean): void {
    const method = on ? 'addEventListener' : 'removeEventListener';
    window[method]('pointermove', onPointerMove as EventListener);
    window[method]('pointerup', release as EventListener);
    window[method]('pointercancel', release as EventListener);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!grab || e.pointerId !== grab.pointerId) {
      return;
    }
    if (!grab.moving) {
      if (Math.hypot(e.clientX - grab.x, e.clientY - grab.y) < DRAG_THRESHOLD) {
        return;
      }
      // The window leaves the layout flow on the first real drag and keeps the
      // exact place it already occupied, so nothing jumps under the pointer.
      node.style.position = 'fixed';
      node.style.margin = '0';
      node.style.left = `${grab.left}px`;
      node.style.top = `${grab.top}px`;
      grab.handle.setPointerCapture(grab.pointerId);
      grab.moving = true;
    }
    e.preventDefault();
    const rect = node.getBoundingClientRect();
    const { left, top } = clampWindowPosition(
      grab.left + e.clientX - grab.x,
      grab.top + e.clientY - grab.y,
      rect,
      { width: document.body.clientWidth, height: document.body.clientHeight },
    );
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  }

  function release(): void {
    grab = null;
    watch(false);
  }

  node.addEventListener('pointerdown', onPointerDown);
  return {
    destroy() {
      node.removeEventListener('pointerdown', onPointerDown);
      watch(false);
    },
  };
}
