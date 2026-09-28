/**
 * The canvas says why a tool did nothing in a live region, and a live region
 * speaks only when its text changes: the same reason twice in a row — a
 * second press on a hidden layer — left the reader silent the second time.
 * A repeat alternates a trailing no-break space, which the eye does not see
 * and the reader does not say, so the text is new and is announced again.
 */
const REPEAT = '\u00a0';

export function nextHint(shown: string, message: string): string {
  return shown === message ? message + REPEAT : message;
}
