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
 * Dragged, the window leaves the flow as `position: absolute` and is kept
 * inside the editor (`[data-float-root]`), not the screen: `fixed`, it stayed
 * where the screen had it while the page under the studio scrolled, and could
 * be dropped over the site's bar or footer (owner, 2026-10-17).
 */

import { createLostRelease } from './lost-release';

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

/** What a window is kept inside: a size, and where it starts when that is
 * not the origin the window's `left`/`top` count from. */
export interface Bounds extends Size {
  left?: number;
  top?: number;
}

/** Keeps a window inside its bounds; one larger than them sits in the corner. */
export function clampWindowPosition(
  left: number,
  top: number,
  size: Size,
  bounds: Bounds,
): { left: number; top: number } {
  const x = bounds.left ?? 0;
  const y = bounds.top ?? 0;
  return {
    left: Math.max(x, Math.min(left, x + bounds.width - size.width)),
    top: Math.max(y, Math.min(top, y + bounds.height - size.height)),
  };
}

/** Where an `absolute` window's `left`/`top` count from: the padding box of
 * the positioned block it stands in, on the screen. */
function origin(node: HTMLElement): { left: number; top: number } {
  const block = (node.offsetParent as HTMLElement | null) ?? document.documentElement;
  const r = block.getBoundingClientRect();
  return { left: r.left + block.clientLeft, top: r.top + block.clientTop };
}

/** The editor the window is kept inside, counted from its `origin`. */
function editorBounds(node: HTMLElement, from: { left: number; top: number }): Bounds {
  const root = node.closest<HTMLElement>('[data-float-root]') ?? document.documentElement;
  const r = root.getBoundingClientRect();
  return {
    left: r.left + root.clientLeft - from.left,
    top: r.top + root.clientTop - from.top,
    width: root.clientWidth,
    height: root.clientHeight,
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
  /** Read once, when the window leaves the flow; neither changes during a drag. */
  size: Size;
  bounds: Bounds;
}

/**
 * Where a window that comes and goes was left, by its name: the transform
 * window is mounted anew at every «Q», and opened over the sheet's corner
 * each time, however often it was moved aside. For as long as the page lives.
 */
const remembered = new Map<string, { left: number; top: number; minWidth: string }>();

export function draggable(node: HTMLElement, remember?: string): { destroy(): void } {
  let grab: Grab | null = null;
  const lostRelease = createLostRelease();
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
    lostRelease.reset();
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
    node.style.position = 'absolute';
    node.style.margin = '0';
    // Counted from the block it now stands in: the place it had stays.
    const from = origin(node);
    grab.left -= from.left;
    grab.top -= from.top;
    node.style.left = `${grab.left}px`;
    node.style.top = `${grab.top}px`;
    const rect = node.getBoundingClientRect();
    grab.size = { width: rect.width, height: rect.height };
    grab.bounds = editorBounds(node, from);
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
    if (lostRelease(e)) {
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
    if (remember) remembered.set(remember, { left, top, minWidth: node.style.minWidth });
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
   * A window dragged once stays where it was left; turning the phone or a
   * smaller editor could put that place past its edge, out of reach. Drawn
   * inside, never stored: the hand's place stays what it was.
   */
  function onResize(): void {
    if (node.style.position !== 'absolute' || !placed) {
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
      editorBounds(node, origin(node)),
    );
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  }

  const was = remember ? remembered.get(remember) : undefined;
  if (was) {
    placed = { left: was.left, top: was.top };
    node.style.minWidth = was.minWidth;
    node.style.position = 'absolute';
    node.style.margin = '0';
    node.style.left = `${was.left}px`;
    node.style.top = `${was.top}px`;
    // The screen may have changed since: drawn inside it, like after a turn.
    onResize();
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
