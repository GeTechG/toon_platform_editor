import { describe, expect, it } from 'bun:test';
import { PALETTE_LIMIT, TONIO_DEFAULT_PALETTE, addPaletteColor } from './color-palette';

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
