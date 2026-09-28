/**
 * A read from the network that cannot hang: it runs out after `ms`, and the
 * caller can call it off sooner (the sheet it was for has closed).
 *
 * Not `AbortSignal.timeout` + `AbortSignal.any`: the build targets Vite's
 * «baseline widely available» (Safari 16.4, Chrome 111), and `any` only came
 * with Safari 17.4 / Chrome 116. One controller with a timer does both, and
 * tells a deadline (`TimeoutError`) from a caller's abort (`AbortError`).
 *
 * The race against the signal covers what a `signal` passed to `fetch` does
 * not always reach — a body that stalls after the headers, or a port in a
 * test that ignores it.
 */
export async function withDeadline<T>(
  ms: number,
  outer: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException(`no answer in ${ms} ms`, 'TimeoutError')),
    ms,
  );
  const forward = () => controller.abort(new DOMException('called off', 'AbortError'));
  if (outer?.aborted) {
    forward();
  } else {
    outer?.addEventListener('abort', forward, { once: true });
  }
  const stopped = new Promise<never>((_, reject) => {
    const fail = () => reject(controller.signal.reason);
    if (controller.signal.aborted) {
      fail();
    } else {
      controller.signal.addEventListener('abort', fail, { once: true });
    }
  });
  try {
    return await Promise.race([run(controller.signal), stopped]);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', forward);
  }
}

/** The deadline ran out — not a caller's abort and not the network's own error. */
export function timedOut(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'TimeoutError';
}

/** Whole seconds for the words: «за 15 секунд». */
export function seconds(ms: number): number {
  return Math.max(1, Math.round(ms / 1000));
}
