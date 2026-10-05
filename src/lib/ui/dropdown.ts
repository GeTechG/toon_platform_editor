/** Where a drop-down's list stands, in the window's pixels; `maxHeight` null is «the window's». */
export interface DropdownPlace {
  x: number;
  y: number;
  maxHeight: number | null;
}

/**
 * Under the button, or above it when the bottom of the window is too near.
 * Where it fits neither side it takes the roomier one and scrolls inside it:
 * laid over its own button, a second press picked an option instead of
 * closing the list. (The brush types' list stands by the same rule.)
 */
export function placeDropdown(
  anchor: { left: number; top: number; bottom: number },
  list: { width: number; height: number },
  view: { width: number; height: number },
): DropdownPlace {
  const below = anchor.bottom + 4;
  const under = view.height - 8 - below;
  const over = anchor.top - 4 - 8;
  const up = list.height > under && over > under;
  const room = up ? over : under;
  const x = Math.max(8, Math.min(anchor.left, view.width - list.width - 8));
  // No side holds even two options (400 % zoom): the list takes the window.
  if (room < 120) return { x, y: 8, maxHeight: null };
  return { x, y: up ? anchor.top - 4 - Math.min(list.height, over) : below, maxHeight: room };
}

/** Arrows walk the options round, Home and End jump to the ends; any other key is not the list's. */
export function stepOption(key: string, from: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowDown':
      return (from + 1) % count;
    case 'ArrowUp':
      return (from - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * A letter typed over the list: the next option after `from` whose name
 * starts with it, round the end. A key with a name (Enter, Tab) and a space
 * are not letters.
 */
export function letterOption(key: string, from: number, names: readonly string[]): number | null {
  if (key.length !== 1 || key === ' ') return null;
  const letter = key.toLocaleLowerCase();
  for (let step = 1; step <= names.length; step++) {
    const at = (from + step) % names.length;
    if (names[at].trim().toLocaleLowerCase().startsWith(letter)) return at;
  }
  return null;
}
