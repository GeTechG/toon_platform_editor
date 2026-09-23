import { afterEach, describe, expect, it } from 'bun:test';
import { parseColourInput } from './color-model';
import { parseSavedPalettes, saveSavedPalettes } from './color-palette';

// Owner's answers after the twelfth audit: the colour window's field takes any
// colour a person pastes, closing it untouched adds nothing to the grid, and
// the palette import tells the truth about storage.
const picker = await Bun.file(new URL('./ColourPicker.svelte', import.meta.url)).text();
const paletteBox = await Bun.file(new URL('./PaletteBox.svelte', import.meta.url)).text();
const sheet = await Bun.file(new URL('./SettingsSheet.svelte', import.meta.url)).text();
const ru = await Bun.file(new URL('../i18n/ru.json', import.meta.url)).json();

// The browser answers for CSS names; here a two-name stand-in is enough.
const names: Record<string, string> = { red: '#ff0000', rebeccapurple: '#663399' };
const named = (name: string) => names[name] ?? null;
const parse = (text: string) => parseColourInput(text, named);

describe('the colour field reads what is pasted into it', () => {
  it('takes #rgb, #rrggbb and bare rrggbb', () => {
    expect(parse('#0A8')).toBe('#00aa88');
    expect(parse(' #7FC9FF ')).toBe('#7fc9ff');
    expect(parse('7fc9ff')).toBe('#7fc9ff');
  });

  it('takes rgb() and rgba() in either syntax and drops the alpha', () => {
    expect(parse('rgb(255,0,0)')).toBe('#ff0000');
    expect(parse('rgba(0, 128, 255, 0.5)')).toBe('#0080ff');
    expect(parse('rgb(0 128 255 / 50%)')).toBe('#0080ff');
    expect(parse('RGB(100%, 50%, 0%)')).toBe('#ff8000');
    expect(parse('rgb(300, -5, 0)')).toBe('#ff0000');
  });

  it('takes hsl() and hsla()', () => {
    expect(parse('hsl(0, 100%, 50%)')).toBe('#ff0000');
    expect(parse('hsla(120, 100%, 25%, 0.3)')).toBe('#008000');
    expect(parse('hsl(240deg 100% 50%)')).toBe('#0000ff');
    expect(parse('hsl(0.5turn 100% 50%)')).toBe('#00ffff');
    expect(parse('hsl(0, 0%, 100%)')).toBe('#ffffff');
  });

  it('takes a CSS colour name through the resolver it is given', () => {
    expect(parse('Red')).toBe('#ff0000');
    expect(parse('rebeccapurple')).toBe('#663399');
    expect(parse('reb')).toBeNull();
    expect(parseColourInput('red')).toBeNull();
  });

  it('paints nothing while the typing is unfinished or rubbish', () => {
    for (const text of ['', '#', '12g', '#12', '1234', '#1234', '#12345', '#1234567', 'rgb(255,0', 'rgb(1,2)', 'rgb(a,b,c)', 'hsl(0,100%)', 'zz']) {
      expect({ text, hex: parse(text) }).toEqual({ text, hex: null });
    }
  });

  it('paints on the fly only from what parses, and gives the old colour back on Enter or blur', () => {
    expect(picker).toMatch(/function typeHex[^]{0,300}parseColourInput\(raw, namedColour\)[^]{0,200}if \(!hex\) return;/);
    expect(picker).toMatch(/function commitHex[^]{0,300}parseColourInput\(hexText, namedColour\)/);
    expect(picker).toMatch(/function commitHex[^]{0,300}else hexText = color;/);
    expect(picker).not.toContain('normalizeHexInput');
  });

  it('asks the browser for names through a canvas, checked against two sentinels', () => {
    expect(picker).toMatch(/function namedColour[^]{0,600}fillStyle/);
  });
});

describe('closing the colour window', () => {
  it('adds to the grid only a colour the window really changed', () => {
    expect(paletteBox).toMatch(/function closePicker[^]{0,700}current !== origin[^]{0,120}paletteAutoAdd/);
  });

  // Found live: Enter closed the window, focus went back to the swatch and the
  // same key pressed it, reopening the window on the new colour — so the close
  // saw no change and added nothing.
  it('keeps the closing Enter from pressing the swatch focus returns to', () => {
    expect(picker).toMatch(/function onKeydown[^]{0,500}e\.preventDefault\(\);[^]{0,80}requestClose\(\);/);
  });
});

describe('palettes.json import', () => {
  it('keeps #rgb colours, expanded', () => {
    const [p] = parseSavedPalettes(JSON.stringify([{ id: 0, colours: ['#F00', '#00aa88', 'nope', '#1234'] }]));
    expect(p.colours).toEqual(['#ff0000', '#00aa88']);
  });

  const realStorage = globalThis.localStorage;
  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = realStorage;
  });

  it('says whether the storage took the list', () => {
    (globalThis as { localStorage?: unknown }).localStorage = { setItem: () => {} };
    expect(saveSavedPalettes([])).toBe(true);
    (globalThis as { localStorage?: unknown }).localStorage = {
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(saveSavedPalettes([])).toBe(false);
  });

  it('does not report «загружено N» when the storage refused', () => {
    expect(sheet).toMatch(/importSavedPalettes[^]{0,300}stored[^]{0,200}settings\.palettes_not_stored/);
    expect(ru.settings.palettes_not_stored).toBeString();
  });
});
