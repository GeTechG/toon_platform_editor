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

/** Reference RemoveColour: the color leaves the grid; an unknown one is a no-op. */
export function removePaletteColor(palette: readonly string[], color: string): string[] {
  const gone = color.toLowerCase();
  return palette.filter((c) => c !== gone);
}

/**
 * Reference MergePalette: appends what the grid lacks, up to the limit, and
 * says how many did not fit so the UI can warn.
 */
export function mergePalettes(
  palette: readonly string[],
  incoming: readonly string[],
  limit: number,
): { palette: string[]; added: number; skipped: number } {
  const fresh = incoming.map((c) => c.toLowerCase()).filter((c) => !palette.includes(c));
  const room = Math.max(0, limit - palette.length);
  const taken = fresh.slice(0, room);
  return { palette: [...palette, ...taken], added: taken.length, skipped: fresh.length - taken.length };
}

/** One of the reference's `toonio_saved_palettes` entries, same field names. */
export interface SavedPalette {
  id: number;
  name: string;
  created: number;
  colours: string[];
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Reference ImportPalettes: entries need an id and a colour list; bad colors are dropped. */
export function parseSavedPalettes(raw: string | null): SavedPalette[] {
  let data: unknown;
  try {
    data = JSON.parse(raw ?? 'null');
  } catch {
    return [];
  }
  if (!Array.isArray(data)) {
    return [];
  }
  const out: SavedPalette[] = [];
  for (const entry of data as Record<string, unknown>[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, name, created, colours } = entry;
    if (typeof id !== 'number' || !Array.isArray(colours)) continue;
    out.push({
      id,
      name: typeof name === 'string' ? name : '',
      created: typeof created === 'number' ? created : 0,
      colours: colours.filter((c): c is string => typeof c === 'string' && HEX.test(c)).map((c) => c.toLowerCase()),
    });
  }
  return out;
}

/** Reference SavePalette: a named copy of the colors, id one past the largest. */
export function withSavedPalette(list: readonly SavedPalette[], name: string, colours: readonly string[]): SavedPalette[] {
  const id = list.reduce((max, p) => Math.max(max, p.id), -1) + 1;
  return [...list, { id, name, created: Date.now(), colours: colours.map((c) => c.toLowerCase()) }];
}

/** Reference GetContrastBlack: ink color for a marker drawn over `hex`. */
export function contrastInk(hex: string): '#000' | '#fff' {
  const n = parseInt(hex.slice(1, 7), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#000' : '#fff';
}

const SAVED_KEY = 'toon-editor:saved-palettes';

export function loadSavedPalettes(): SavedPalette[] {
  try {
    return parseSavedPalettes(localStorage.getItem(SAVED_KEY));
  } catch {
    return [];
  }
}

/** Best-effort, never throws. */
export function saveSavedPalettes(list: readonly SavedPalette[]): void {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch {
    // blocked storage — the list lives for the session only.
  }
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
