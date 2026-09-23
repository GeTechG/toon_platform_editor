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
/** One line's length: an object logged whole (a document) is megabytes. */
const LINE_LIMIT = 4000;

/** A thrown thing as the log wants it: an error with its stack, an object with its fields. */
function describe(what: unknown): string {
  if (what instanceof Error) {
    // Firefox and Safari write a stack of frames only, without the message.
    const head = `${what.name}: ${what.message}`;
    return what.stack?.includes(what.message) ? what.stack : `${head}\n${what.stack ?? ''}`.trimEnd();
  }
  if (typeof what === 'object' && what !== null) {
    try {
      return JSON.stringify(what) ?? String(what);
    } catch {
      return String(what);
    }
  }
  return String(what);
}

export function createErrorLog() {
  const lines: string[] = [];
  let watching = false;

  const note = (what: unknown): void => {
    if (lines.length >= LIMIT) {
      lines.shift();
    }
    const text = describe(what);
    lines.push(`${new Date().toISOString()} ${text.length > LINE_LIMIT ? `${text.slice(0, LINE_LIMIT)}…` : text}`);
  };

  return {
    lines,
    watch(target: ErrorSource, con: ErrorConsole): void {
      if (watching) {
        return;
      }
      watching = true;
      target.addEventListener('error', (e) => {
        const { error, message } = e as ErrorEvent;
        // The browser's word that a resize was finished next frame, not a
        // fault: the studio's measured panels raise it on every window resize,
        // and a dozen of them pushed the real errors out of the 200 lines.
        if (!error && /^ResizeObserver loop/.test(message ?? '')) {
          return;
        }
        note(error ?? message);
      });
      target.addEventListener('unhandledrejection', (e) => note((e as PromiseRejectionEvent).reason));
      const wasError = con.error.bind(con);
      con.error = (...args: unknown[]) => {
        note(args.map(describe).join(' '));
        wasError(...args);
      };
    },
  };
}

/** The page's own log, shared by every editor mounted on it. */
export const sessionErrors = createErrorLog();
