/**
 * The saved color grid of the Tonio preset: the reference's 30 default
 * swatches plus whatever the user adds, capped and persisted best-effort.
 */

import type { ToonDocument } from '../format/types';

/** toonio.bundle.js `defaultPalette`, verbatim. */
export const TONIO_DEFAULT_PALETTE: readonly string[] = (
  '#000000 #404040 #606060 #808080 #a0a0a0 #ffffff #ff0000 #ff6a00 #ffd800 #b6ff00 ' +
  '#00ff21 #00ff90 #ff7f7f #ffb27f #ffe97f #daff7f #7fff8e #7fffc5 #00ffff #0094ff ' +
  '#0026ff #b200ff #ff00dc #ff006e #7fffff #7fc9ff #7f92ff #d67fff #ff7fed #ff7fb6'
).split(' ');

/** Reference `paletteLimit` default; the settings sheet moves it between 30 and 300. */
export const PALETTE_LIMIT = 50;

/**
 * The grid is a set, not a list: it is keyed by colour, so a repeat is not a
 * cosmetic duplicate — it takes the editor down with `each_key_duplicate`, and
 * removing one of the pair would remove both. Every way colours enter the grid
 * goes through here.
 */
export function uniqueColours(colours: readonly string[]): string[] {
  return [...new Set(colours.map((colour) => colour.toLowerCase()))];
}

/**
 * Reference AddColourToPalette (`bundle:7828-7867`). While there is room the
 * colour joins the end; at the limit it overwrites the cell at `cursor` in
 * place — the grid is a ring, so the other cells never shift — and the cursor
 * moves on. Lowering the limit cuts the tail and replaces from the first cell.
 */
export function addPaletteColor(
  palette: readonly string[],
  color: string,
  limit = PALETTE_LIMIT,
  cursor = 0,
): { palette: string[]; cursor: number } {
  const next = color.toLowerCase();
  if (palette.includes(next)) {
    return { palette: palette.slice(), cursor };
  }
  if (palette.length < limit) {
    return { palette: [...palette, next], cursor };
  }
  const grid = palette.slice(0, limit);
  const at = ((cursor % limit) + limit) % limit;
  grid[at] = next;
  return { palette: grid, cursor: (at + 1) % limit };
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
  const fresh = uniqueColours(incoming).filter((c) => !palette.includes(c));
  const room = Math.max(0, limit - palette.length);
  const taken = fresh.slice(0, room);
  return { palette: [...palette, ...taken], added: taken.length, skipped: fresh.length - taken.length };
}

/**
 * Reference behaviour on opening a file: the grid has no home of its own, so
 * the colours the drawing uses join it (`bundle:7469-7470`). Order follows the
 * tool table; the limit still caps the grid.
 */
export function stealPalette(
  palette: readonly string[],
  doc: ToonDocument,
  limit: number,
): string[] {
  const colours = doc.tools.flatMap((tool) => [
    'color' in tool ? tool.color : [],
    'fill' in tool ? tool.fill : [],
  ].flat());
  return mergePalettes(palette, colours, limit).palette;
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

/** The reference's `palettes.json`: the saved list, verbatim. */
export function exportPalettes(list: readonly SavedPalette[]): string {
  return JSON.stringify(list);
}

/**
 * Reference ImportPalettes: everything the file holds joins the list, under
 * fresh ids so an import can never shadow a palette already saved. Broken
 * entries and colours are dropped; the count is what the UI reports.
 */
export function importPalettes(
  list: readonly SavedPalette[],
  raw: string | null,
): { palettes: SavedPalette[]; loaded: number } {
  const incoming = parseSavedPalettes(raw);
  let next = list.reduce((max, p) => Math.max(max, p.id), -1) + 1;
  const renumbered = incoming.map((p) => ({ ...p, id: next++ }));
  return { palettes: [...list, ...renumbered], loaded: renumbered.length };
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

/**
 * The grid the editor starts from when no draft is opened. The reference keeps
 * no global palette at all (`bundle:7469-7470, 7572-7594`): a drawing's colours
 * come from its draft, and `restoreState` overwrites whatever this returned —
 * so this is the fallback, not the source of truth.
 */
export function loadPalette(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(raw) && raw.every((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/.test(c))) {
      // The settings sheet can raise the limit to 300; the cap belongs to
      // addPaletteColor, so loading must not cut a grid saved under it.
      // Deduplicated on the way in: a grid written by an older build may hold
      // repeats, and the editor must open rather than crash on the keyed grid.
      return uniqueColours(raw);
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

/**
 * Where an arrow key moves focus in a grid of `count` cells, `cols` to a row.
 * The edges stop, not wrap (WAI-ARIA APG grid). Null: the key is not the grid's.
 */
export function gridStep(at: number, key: string, count: number, cols: number): number | null {
  const last = count - 1;
  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, at - 1);
    case 'ArrowRight':
      return Math.min(last, at + 1);
    case 'ArrowUp':
      return at - cols >= 0 ? at - cols : at;
    case 'ArrowDown':
      return at + cols <= last ? at + cols : at;
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}
