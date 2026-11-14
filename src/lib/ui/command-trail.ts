/**
 * What the studio was asked to do, by name: `tool:brush`, `frame-add`,
 * `paste`. The page that embeds it may listen - the site keeps the last of
 * them with an error report, so a fault comes with the steps that led to it.
 * A name and nothing more: no stroke, no picture, no text goes out of here.
 */
type Listener = (name: string) => void;

const listeners = new Set<Listener>();

/** Listen to the studio's commands; the answer stops listening. */
export function onEditorCommand(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function reportCommand(name: string): void {
  for (const listener of listeners) {
    // Whoever listens must not cost the studio the command it was given.
    try {
      listener(name);
    } catch {
      // The listener's own fault; the studio goes on.
    }
  }
}
