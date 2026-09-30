/**
 * Who takes the focus from a control that has just switched itself off: the
 * next usable one in Tab order, or, at the end, the nearest one before it.
 * Chrome drops the focus of a disabled button on <body>, where a reader loses
 * the place and the next Tab starts over.
 */
export function focusHeir<T>(list: readonly T[], from: T, usable: (item: T) => boolean): T | null {
  const at = list.indexOf(from);
  if (at < 0) return null;
  return list.slice(at + 1).find(usable) ?? list.slice(0, at).reverse().find(usable) ?? null;
}

/**
 * A selector for the same control drawn elsewhere — the tab window's key in
 * the desktop's column: its id, its tool, or its name, on the same tag.
 */
export function twinSelector(el: { tagName: string; getAttribute(name: string): string | null }): string | null {
  const name = ['id', 'data-tool', 'aria-label'].find((attr) => el.getAttribute(attr));
  if (!name) return null;
  const value = el.getAttribute(name)!.replace(/["\\]/g, '\\$&');
  return `${el.tagName.toLowerCase()}[${name}="${value}"]`;
}
