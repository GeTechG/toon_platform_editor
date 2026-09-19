/**
 * The reference's floating tool windows (zoom, transform) are dragged by
 * their title bar and never leave the page. One action serves both: it moves
 * the element it is put on, started from any child marked `data-drag-handle`.
 */

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

export function draggable(node: HTMLElement): { destroy(): void } {
  let grab: { x: number; y: number; left: number; top: number } | null = null;

  function onPointerDown(e: PointerEvent): void {
    const handle = (e.target as HTMLElement | null)?.closest('[data-drag-handle]');
    if (e.button !== 0 || !handle || !node.contains(handle)) {
      return;
    }
    const rect = node.getBoundingClientRect();
    // The window leaves the layout flow on the first drag and keeps the exact
    // place it already occupied, so nothing jumps under the pointer.
    node.style.position = 'fixed';
    node.style.margin = '0';
    node.style.left = `${rect.left}px`;
    node.style.top = `${rect.top}px`;
    grab = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
    (handle as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!grab) {
      return;
    }
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
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointerup', release);
  node.addEventListener('pointercancel', release);
  return {
    destroy() {
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', release);
      node.removeEventListener('pointercancel', release);
    },
  };
}
