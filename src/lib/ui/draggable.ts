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
/** A finger is never that still: a tap on «+» that trembled 5px was a drag, and the key lost it. */
const TOUCH_DRAG_THRESHOLD = 10;

/** Whether a press that has travelled (dx, dy) is a drag: 4px for a mouse or a pen, 10 for a finger. */
export function pastDragThreshold(dx: number, dy: number, pointerType: string): boolean {
  return Math.hypot(dx, dy) >= (pointerType === 'touch' ? TOUCH_DRAG_THRESHOLD : DRAG_THRESHOLD);
}

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

/**
 * What a `fixed` window is kept inside: the screen, scrollbars excluded. The
 * body it used to be is the page's height — longer than the screen where the
 * page under the studio scrolls, and a window went below the bottom edge.
 */
function screenBounds(): Size {
  const view = document.documentElement ?? document.body;
  return { width: view.clientWidth, height: view.clientHeight };
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
  /** Read once, when the window leaves the flow; neither changes during a drag. */
  size: Size;
  bounds: Size;
}

export function draggable(node: HTMLElement): { destroy(): void } {
  let grab: Grab | null = null;
  /**
   * Where the hand left it. A smaller screen draws it pushed inside, and a
   * bigger one again brings it back here: clamped in place, a phone turned
   * there and back moved it for good.
   */
  let placed: { left: number; top: number } | null = null;

  function onPointerDown(e: PointerEvent): void {
    const handle = (e.target as HTMLElement | null)?.closest('[data-drag-handle]');
    // A second finger on the handle took the window from the first.
    if (grab || e.button !== 0 || !handle || !node.contains(handle)) {
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
      // Filled by `beginDrag`, once the window is out of the flow.
      size: { width: rect.width, height: rect.height },
      bounds: { width: 0, height: 0 },
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

  /**
   * The window leaves the layout flow and keeps the exact place it already
   * occupied, so nothing jumps under the pointer — and the two things the
   * clamp needs are measured here, once. They were being read on every
   * `pointermove`, right after the previous move had written `left`/`top` on
   * the same element: a write, then a read of the layout that write had just
   * dirtied, then another write. A forced reflow per pointer sample, during a
   * drag people perform with the other hand still drawing.
   */
  function beginDrag(): void {
    if (!grab) {
      return;
    }
    // The width came from the column it stood in, and a window that is a
    // size container (the transform one) has no width of its own to fall back
    // on: out of the flow it folded into a 19px strip. A floor, not a width —
    // the zoom window still grows with «1 000 %». Nothing takes the window
    // back into the flow, so nothing has to lift it.
    node.style.minWidth = `${grab.size.width}px`;
    node.style.position = 'fixed';
    node.style.margin = '0';
    node.style.left = `${grab.left}px`;
    node.style.top = `${grab.top}px`;
    const rect = node.getBoundingClientRect();
    grab.size = { width: rect.width, height: rect.height };
    grab.bounds = screenBounds();
    grab.handle.setPointerCapture(grab.pointerId);
    grab.moving = true;
  }

  function onPointerMove(e: PointerEvent): void {
    if (!grab || e.pointerId !== grab.pointerId) {
      return;
    }
    // A mouse or pen moving with nothing pressed let go where its release
    // never came from (Ctrl+click on a Mac opens the menu, which swallows
    // it): the window then rode the bare hover.
    if (e.pointerType !== 'touch' && e.buttons === 0) {
      release();
      return;
    }
    if (!grab.moving) {
      if (!pastDragThreshold(e.clientX - grab.x, e.clientY - grab.y, e.pointerType)) {
        return;
      }
      beginDrag();
    }
    e.preventDefault();
    const { left, top } = clampWindowPosition(
      grab.left + e.clientX - grab.x,
      grab.top + e.clientY - grab.y,
      grab.size,
      grab.bounds,
    );
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    placed = { left, top };
  }

  /** Only the finger that holds it lets go: another one lifting ended the drag. */
  function release(e?: PointerEvent): void {
    if (e && grab && e.pointerId !== grab.pointerId) {
      return;
    }
    grab = null;
    watch(false);
  }

  /**
   * A window dragged once stays `fixed` where it was left; turning the phone
   * could put that place past the new screen edge, out of reach. Drawn inside,
   * never stored: the hand's place stays what it was.
   */
  function onResize(): void {
    if (node.style.position !== 'fixed' || !placed) {
      return;
    }
    const rect = node.getBoundingClientRect();
    // Hidden (the transform window takes its row), it measures nothing: read
    // as a box at 0,0, it was put in the corner.
    if (rect.width === 0 && rect.height === 0) {
      return;
    }
    const { left, top } = clampWindowPosition(
      placed.left,
      placed.top,
      { width: rect.width, height: rect.height },
      screenBounds(),
    );
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  }

  node.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('resize', onResize);
  return {
    destroy() {
      node.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', onResize);
      watch(false);
    },
  };
}
