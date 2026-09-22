/**
 * "Tell me when this cell comes into view" — one observer for every cell of
 * the timeline strip.
 *
 * The strip is frames × layers, and the format allows 4096 frames: a document
 * of three hundred is already a thousand cells. A pair of `IntersectionObserver`
 * per cell is a thousand observers, which is the cost the window of visibility
 * was put there to remove in the first place.
 *
 * A cell is told once and then let go: the context it takes is not given back
 * (freeing one means resizing the canvas to nothing, and redrawing every cell
 * on every scroll costs more than the memory it returns).
 */

type Seen = () => void;

/** A screen of margin either side, so a cell is drawn before the scroll reaches it. */
const ROOT_MARGIN = '200px';

/**
 * A watcher and the one observer behind it. The editor uses the single
 * instance below; a caller that wants its own — a test, a second strip — makes
 * one, and nothing is shared between them.
 */
export function makeWatcher(): (el: Element, seen: Seen) => () => void {
  const waiting = new WeakMap<Element, Seen>();
  let observer: IntersectionObserver | undefined;

  const shared = (): IntersectionObserver => {
    observer ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }
          const seen = waiting.get(entry.target);
          if (!seen) {
            continue;
          }
          waiting.delete(entry.target);
          observer?.unobserve(entry.target);
          seen();
        }
      },
      { rootMargin: ROOT_MARGIN },
    );
    return observer;
  };

  return (el, seen) => {
    if (typeof IntersectionObserver === 'undefined') {
      seen();
      return () => {};
    }
    const io = shared();
    waiting.set(el, seen);
    io.observe(el);
    return () => {
      waiting.delete(el);
      io.unobserve(el);
    };
  };
}

/**
 * Calls `seen` once, when `el` first comes within a screen of the view.
 * Returns the way to stop waiting — a cell taken off the strip.
 *
 * On an engine without the observer the cell is drawn at once: no observer is
 * a reason to draw, not a reason to show an empty cell.
 */
export const whenOnScreen = makeWatcher();
