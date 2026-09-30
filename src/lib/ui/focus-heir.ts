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
