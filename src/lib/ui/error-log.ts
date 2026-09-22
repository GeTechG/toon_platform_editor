/**
 * Everything the page logs as an error, so Alt+L has something to hand over.
 * One log per page, installed once: an editor that watched the window itself
 * was kept alive by its listeners long after the site navigated away from it.
 */

interface ErrorSource {
  addEventListener(type: string, listener: (e: Event) => void): void;
}

interface ErrorConsole {
  error: (...args: unknown[]) => void;
}

const LIMIT = 200;

export function createErrorLog() {
  const lines: string[] = [];
  let watching = false;

  const note = (what: unknown): void => {
    if (lines.length >= LIMIT) {
      lines.shift();
    }
    lines.push(`${new Date().toISOString()} ${what instanceof Error ? what.stack ?? what.message : String(what)}`);
  };

  return {
    lines,
    watch(target: ErrorSource, con: ErrorConsole): void {
      if (watching) {
        return;
      }
      watching = true;
      target.addEventListener('error', (e) => note((e as ErrorEvent).error ?? (e as ErrorEvent).message));
      target.addEventListener('unhandledrejection', (e) => note((e as PromiseRejectionEvent).reason));
      const wasError = con.error.bind(con);
      con.error = (...args: unknown[]) => {
        note(args.join(' '));
        wasError(...args);
      };
    },
  };
}

/** The page's own log, shared by every editor mounted on it. */
export const sessionErrors = createErrorLog();
