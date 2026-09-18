import { describe, expect, it } from 'bun:test';
import {
  PALETTE_LIMIT,
  TONIO_DEFAULT_PALETTE,
  addPaletteColor,
  contrastInk,
  mergePalettes,
  parseSavedPalettes,
  removePaletteColor,
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
