import { describe, expect, it } from 'bun:test';
import { parseColourInput } from './color-model';

// Owner's answers after the thirteenth audit: the active layer row gets a mark
// of its own — no ring round the row, no soft shadow — and the colour field
// reads the modern CSS colour functions, parsed by the browser.
const tokens = await Bun.file(new URL('./tokens.css', import.meta.url)).text();
const rowsUi = await Bun.file(new URL('./LayerRows.svelte', import.meta.url)).text();
const picker = await Bun.file(new URL('./ColourPicker.svelte', import.meta.url)).text();

function token(name: string): string {
  const value = tokens.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();
  if (!value) throw new Error(`missing --${name}`);
  const ref = value.match(/^var\(--([\w-]+)\)$/);
  return ref ? token(ref[1]) : value;
}
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (c: number[]) => {
  const [r, g, b] = c.map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const rule = (selector: string) => {
  const at = rowsUi.indexOf(`${selector} {`);
  return at < 0 ? '' : rowsUi.slice(at, rowsUi.indexOf('}', at));
};

describe('the active layer row carries a mark of its own', () => {
  const paper = rgb(token('paper'));
  const accent = rgb(token('accent'));
  const share = Number(rule('.row.active').match(/var\(--accent\) (\d+)%/)?.[1]) / 100;
  const activeRow = paper.map((p, i) => p + (accent[i] - p) * share);

  it('a bar in the accent at the row’s left edge, 3:1 on the row it marks', () => {
    const bar = rule('.row.active::before');
    expect(bar).toContain('background: var(--accent)');
    expect(bar).toMatch(/left: 0/);
    expect(bar).toMatch(/width: [3-4]px/);
    expect(rule('.row')).toContain('position: relative');
    expect(ratio(accent, activeRow)).toBeGreaterThanOrEqual(3);
    expect(ratio(accent, paper)).toBeGreaterThanOrEqual(3);
  });

  it('the name goes heavy and red, as a picked tool’s ink does — never colour alone', () => {
    const name = rule('.row.active .name');
    expect(name).toMatch(/font-weight: (6|7)00/);
    expect(name).toContain('color: var(--accent-ink)');
    expect(ratio(rgb(token('accent-ink')), activeRow)).toBeGreaterThanOrEqual(4.5);
  });

  it('no ring round the row and no soft shadow: the fill stays 12 %', () => {
    const active = rule('.row.active');
    expect(share).toBe(0.12);
    expect(active).not.toMatch(/border|outline|box-shadow/);
    expect(rule('.row.active::before')).not.toMatch(/box-shadow|blur/);
  });

  it('forced colours keep the bar in Highlight', () => {
    expect(rowsUi).toMatch(/@media \(forced-colors: active\)[^]{0,200}\.row\.active::before[^]{0,120}Highlight/);
  });
});

describe('the colour field hands the modern functions to the browser', () => {
  function run(text: string) {
    const asked: string[] = [];
    const hex = parseColourInput(text, (s) => {
      asked.push(s);
      return '#123456';
    });
    return { hex, asked };
  }

  it('oklch, hwb, lab, lch, oklab and color() go to the resolver as written', () => {
    for (const text of [
      'oklch(0.7 0.1 200)',
      'oklch(70% 0.1 200deg)',
      'hwb(120 10% 20%)',
      'lab(50 40 -20)',
      'lch(50% 30 120)',
      'oklab(0.6 -0.1 0.1)',
      'color(display-p3 1 0 0)',
      'color(srgb 0.5 0.5 0.5)',
      'oklch(0.7 none 200)',
    ]) {
      expect({ text, ...run(text) }).toEqual({ text, hex: '#123456', asked: [text] });
    }
  });

  it('is case- and space-tolerant and drops the alpha, as #rrggbbaa does', () => {
    expect(run('  OKLCH( 0.7  0.1 200 / 0.5 ) ').asked).toEqual(['oklch(0.7 0.1 200)']);
    expect(run('lab(50 40 -20 / 20%)').asked).toEqual(['lab(50 40 -20)']);
    expect(run('color(Display-P3 1 0 0 / .3)').asked).toEqual(['color(display-p3 1 0 0)']);
  });

  it('turns rubbish down without asking the browser', () => {
    for (const text of [
      'oklch(',
      'oklch()',
      'oklch(0.7 0.1)',
      'oklch(0.7 0.1 200 300)',
      'oklch(a b c)',
      'hwb(120, 10%, 20%, 1, 2)',
      'lab(50 40 -20 /)',
      'lab(50 40 -20 / 0.5 / 1)',
      'color(1 0 0)',
      'color(nowhere 1 0 0)',
      'color(srgb 1 0)',
      'oklch(calc(1) 0 0)',
      'oklch(0.7 0.1 200px)',
      'lab(50 40 -20)x',
    ]) {
      expect({ text, ...run(text) }).toEqual({ text, hex: null, asked: [] });
    }
  });

  it('paints nothing when the browser does not know the colour', () => {
    expect(parseColourInput('oklch(0.7 0.1 200)', () => null)).toBeNull();
    expect(parseColourInput('oklch(0.7 0.1 200)')).toBeNull();
  });

  it('the browser answers by painting a pixel: a modern colour is not read back as hex', () => {
    expect(picker).toMatch(/function namedColour[^]{0,1400}fillRect\(0, 0, 1, 1\)[^]{0,200}getImageData\(0, 0, 1, 1\)/);
  });
});
