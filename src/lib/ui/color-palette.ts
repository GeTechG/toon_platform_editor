/**
 * The saved color grid of the Tonio preset: the reference's 30 default
 * swatches plus whatever the user adds, capped and persisted best-effort.
 */

/** toonio.bundle.js `defaultPalette`, verbatim. */
export const TONIO_DEFAULT_PALETTE: readonly string[] = (
  '#000000 #404040 #606060 #808080 #a0a0a0 #ffffff #ff0000 #ff6a00 #ffd800 #b6ff00 ' +
  '#00ff21 #00ff90 #ff7f7f #ffb27f #ffe97f #daff7f #7fff8e #7fffc5 #00ffff #0094ff ' +
  '#0026ff #b200ff #ff00dc #ff006e #7fffff #7fc9ff #7f92ff #d67fff #ff7fed #ff7fb6'
).split(' ');

/** Reference `paletteLimit`. Full palette drops its oldest color instead of the reference's wipe. */
export const PALETTE_LIMIT = 50;

export function addPaletteColor(palette: readonly string[], color: string): string[] {
  const next = color.toLowerCase();
  if (palette.includes(next)) {
    return palette.slice();
  }
  return [...palette, next].slice(-PALETTE_LIMIT);
}

const STORAGE_KEY = 'toon-editor:palette';

/** Saved palette, or the reference defaults when there is none / on any failure. */
export function loadPalette(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(raw) && raw.every((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/.test(c))) {
      return raw.slice(0, PALETTE_LIMIT);
    }
  } catch {
    // blocked or corrupted storage — fall through to the defaults.
  }
  return TONIO_DEFAULT_PALETTE.slice();
}

/** Persists the palette. Best-effort — never throws. */
export function savePalette(palette: readonly string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(palette));
  } catch {
    // private mode / blocked storage — degrade to no-op.
  }
}
