import { describe, expect, it } from 'bun:test';
import type { ToolDescriptor, ToonDocument } from '../format/types';
import {
  PALETTE_LIMIT,
  TONIO_DEFAULT_PALETTE,
  addPaletteColor,
  contrastInk,
  exportPalettes,
  importPalettes,
  loadPalette,
  mergePalettes,
  parseSavedPalettes,
  removePaletteColor,
  stealPalette,
  withSavedPalette,
} from './color-palette';

describe('TONIO_DEFAULT_PALETTE', () => {
  it('is the reference palette of 30 colors', () => {
    expect(TONIO_DEFAULT_PALETTE).toHaveLength(30);
    expect(TONIO_DEFAULT_PALETTE[0]).toBe('#000000');
    expect(TONIO_DEFAULT_PALETTE[5]).toBe('#ffffff');
    expect(TONIO_DEFAULT_PALETTE.at(-1)).toBe('#ff7fb6');
  });
});

describe('addPaletteColor', () => {
  it('appends a new color', () => {
    expect(addPaletteColor(['#000000'], '#123456')).toEqual(['#000000', '#123456']);
  });

  it('normalizes case and keeps a color it already has', () => {
    expect(addPaletteColor(['#123456'], '#123456')).toEqual(['#123456']);
    expect(addPaletteColor(['#123456'], '#123456'.toUpperCase())).toEqual(['#123456']);
  });

  it('drops the oldest color once the palette is full', () => {
    const full = Array.from({ length: PALETTE_LIMIT }, (_, i) => `#0000${i.toString(16).padStart(2, '0')}`);
    const grown = addPaletteColor(full, '#ffffff');
    expect(grown).toHaveLength(PALETTE_LIMIT);
    expect(grown[0]).toBe(full[1]);
    expect(grown.at(-1)).toBe('#ffffff');
  });
});

describe('removePaletteColor', () => {
  it('drops the color, ignoring case, and leaves an unknown one alone', () => {
    expect(removePaletteColor(['#000000', '#ff0000'], '#FF0000')).toEqual(['#000000']);
    expect(removePaletteColor(['#000000'], '#123456')).toEqual(['#000000']);
  });
});

describe('mergePalettes', () => {
  it('appends only the colors the palette lacks', () => {
    const merged = mergePalettes(['#000000'], ['#000000', '#ff0000', '#00ff00'], 50);
    expect(merged.palette).toEqual(['#000000', '#ff0000', '#00ff00']);
    expect(merged.added).toBe(2);
    expect(merged.skipped).toBe(0);
  });

  it('stops at the limit and reports what did not fit', () => {
    const merged = mergePalettes(['#000000'], ['#ff0000', '#00ff00', '#0000ff'], 3);
    expect(merged.palette).toEqual(['#000000', '#ff0000', '#00ff00']);
    expect(merged.added).toBe(2);
    expect(merged.skipped).toBe(1);
  });
});

describe('saved palettes', () => {
  it('parses the reference toonio_saved_palettes shape and drops malformed colors', () => {
    const raw = JSON.stringify([
      { id: 0, name: 'Тёплая', created: 5, colours: ['#FF0000', 'red', '#00ff00'] },
      { name: 'no id' },
    ]);
    expect(parseSavedPalettes(raw)).toEqual([
      { id: 0, name: 'Тёплая', created: 5, colours: ['#ff0000', '#00ff00'] },
    ]);
    expect(parseSavedPalettes('garbage')).toEqual([]);
    expect(parseSavedPalettes(null)).toEqual([]);
  });

  it('appends a named copy of the colors with a fresh id', () => {
    const list = withSavedPalette([{ id: 3, name: 'a', created: 1, colours: ['#000000'] }], 'b', ['#ffffff']);
    expect(list).toHaveLength(2);
    expect(list[1].name).toBe('b');
    expect(list[1].colours).toEqual(['#ffffff']);
    expect(list[1].id).toBe(4);
  });
});

describe('contrastInk', () => {
  it('is black on light colors and white on dark ones', () => {
    expect(contrastInk('#ffffff')).toBe('#000');
    expect(contrastInk('#ffd800')).toBe('#000');
    expect(contrastInk('#000000')).toBe('#fff');
    expect(contrastInk('#0026ff')).toBe('#fff');
  });
});

describe('the palette limit from the settings', () => {
  it('appends up to the limit it is given', () => {
    expect(addPaletteColor(['#000000'], '#123456', 30)).toEqual(['#000000', '#123456']);
  });

  it('drops colors from the start once the grid is at its limit', () => {
    const full = ['#000000', '#111111', '#222222'];
    expect(addPaletteColor(full, '#ffffff', 3)).toEqual(['#111111', '#222222', '#ffffff']);
  });

  it('brings a grid saved under a larger limit back down to the new one', () => {
    const wide = Array.from({ length: 60 }, (_, i) => `#0000${i.toString(16).padStart(2, '0')}`);
    const grown = addPaletteColor(wide, '#ffffff', 30);
    expect(grown).toHaveLength(30);
    expect(grown.at(-1)).toBe('#ffffff');
    expect(grown[0]).toBe(wide[31]);
  });
});

describe('exportPalettes / importPalettes', () => {
  it('round-trips the saved palettes through the reference file format', () => {
    const list = withSavedPalette([], 'мои', ['#000000', '#FF0000']);
    expect(parseSavedPalettes(exportPalettes(list))).toEqual(list);
  });

  it('gives imported palettes ids of their own so they never collide', () => {
    const mine = withSavedPalette([], 'мои', ['#000000']);
    const file = exportPalettes(withSavedPalette([], 'чужие', ['#ff0000']));
    const { palettes, loaded } = importPalettes(mine, file);
    expect(loaded).toBe(1);
    expect(palettes).toHaveLength(2);
    expect(new Set(palettes.map((p) => p.id)).size).toBe(2);
    expect(palettes[1]?.colours).toEqual(['#ff0000']);
  });

  it('drops broken entries and invalid colors, and reports what was loaded', () => {
    const file = JSON.stringify([
      { id: 0, name: 'ок', created: 1, colours: ['#00ff00', 'red'] },
      { name: 'без id', colours: ['#000000'] },
      'мусор',
    ]);
    const { palettes, loaded } = importPalettes([], file);
    expect(loaded).toBe(1);
    expect(palettes[0]?.colours).toEqual(['#00ff00']);
  });

  it('reports nothing loaded from a file that is not a palette export', () => {
    expect(importPalettes([], '{')).toEqual({ palettes: [], loaded: 0 });
  });
});

describe('loadPalette', () => {
  it('keeps a grid saved under a raised limit instead of cutting it to the default', () => {
    // bun test has no DOM; a Map is all loadPalette asks of localStorage.
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    try {
      const wide = Array.from({ length: 200 }, (_, i) => `#${i.toString(16).padStart(6, '0')}`);
      store.set('toon-editor:palette', JSON.stringify(wide));
      expect(loadPalette()).toEqual(wide);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

describe('stealPalette', () => {
  /** A document whose tool table carries the colours to steal. */
  const doc = (tools: ToolDescriptor[]): ToonDocument => ({
    schema_version: 5,
    width: 10240,
    height: 5760,
    frame_rate: 12,
    tools,
    layers: [{ hidden: false, frames: [{ strokes: [] }] }],
  });

  it('appends the colours of the opened document the grid lacks', () => {
    const stolen = stealPalette(['#000000'], doc([
      { kind: 'pencil', dialect: 'toonio', width: 40, color: '#Ff0000' },
      { kind: 'eraser', dialect: 'toonio', width: 40 },
      { kind: 'feather', dialect: 'toonio', width: 40, color: '#00ff00', fill: '#0000ff' },
      { kind: 'pencil', dialect: 'toonio', width: 8, color: '#000000' },
    ]), 50);
    expect(stolen).toEqual(['#000000', '#ff0000', '#00ff00', '#0000ff']);
  });

  it('stops at the limit and leaves the grid alone when it has them all', () => {
    expect(stealPalette(['#000000'], doc([
      { kind: 'pencil', dialect: 'toonio', width: 40, color: '#ff0000' },
      { kind: 'pencil', dialect: 'toonio', width: 40, color: '#00ff00' },
    ]), 2)).toEqual(['#000000', '#ff0000']);
    expect(stealPalette(['#ff0000'], doc([
      { kind: 'pencil', dialect: 'toonio', width: 40, color: '#ff0000' },
    ]), 50)).toEqual(['#ff0000']);
  });
});

describe('a palette is a set: one swatch per colour', () => {
  it('mergePalettes drops repeats inside the incoming list, not just the ones already there', () => {
    // The grid is keyed by colour, so a repeat is not a cosmetic duplicate —
    // it takes the whole editor down with `each_key_duplicate`.
    const merged = mergePalettes(['#000000'], ['#e2e8f0', '#E2E8F0', '#000000', '#ff0000'], 50);
    expect(merged.palette).toEqual(['#000000', '#e2e8f0', '#ff0000']);
    expect(merged.added).toBe(2);
  });

  it('stealPalette takes a colour used by two tools only once', () => {
    const doc: ToonDocument = {
      schema_version: 5,
      width: 10240,
      height: 5760,
      frame_rate: 12,
      tools: [
        { kind: 'pencil', dialect: 'toonio', width: 40, color: '#e2e8f0' },
        { kind: 'pencil', dialect: 'toonio', width: 144, color: '#e2e8f0' },
        { kind: 'feather', dialect: 'toonio', width: 40, color: '#e2e8f0', fill: '#e2e8f0' },
      ],
      layers: [{ hidden: false, frames: [{ strokes: [] }] }],
    };
    const stolen = stealPalette(['#000000'], doc, 50);
    expect(stolen).toEqual(['#000000', '#e2e8f0']);
    expect(new Set(stolen).size).toBe(stolen.length);
  });

  it('a grid saved with duplicates in it comes back clean', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    try {
      store.set('toon-editor:palette', JSON.stringify(['#000000', '#e2e8f0', '#e2e8f0', '#ff0000']));
      expect(loadPalette()).toEqual(['#000000', '#e2e8f0', '#ff0000']);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
