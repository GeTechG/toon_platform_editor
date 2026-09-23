import { describe, expect, it } from 'bun:test';

// Owner's call after the eleventh audit: a layer tag is the «Цвет слоя» button,
// non-text UI, so WCAG 1.4.11 wants 3:1 against every row it sits on. Colours
// are read from the shipped tokens, not copied here.
const tokens = await Bun.file(new URL('./tokens.css', import.meta.url)).text();
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const rowsUi = await Bun.file(new URL('./LayerRows.svelte', import.meta.url)).text();

function token(source: string, name: string): string {
  const value = source.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();
  if (!value) throw new Error(`missing --${name}`);
  const ref = value.match(/^var\(--([\w-]+)\)$/);
  return ref ? token(tokens, ref[1]) : value;
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (c: number[]) => {
  const [r, g, b] = c.map((v) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const paper = rgb(token(tokens, 'paper'));
const accent = rgb(token(tokens, 'accent'));
// `.row.active` is the accent at 12 % over the panel's paper.
const share = Number(rowsUi.match(/\.row\.active \{\s*background: color-mix\(in srgb, var\(--accent\) (\d+)%, transparent\)/)![1]) / 100;
const activeRow = paper.map((p, i) => p + (accent[i] - p) * share);
// The rows have no hover fill of their own: a hovered row is the paper.
const backgrounds = { paper, active: activeRow, hover: paper };

describe('layer tags after the eleventh audit', () => {
  for (let i = 0; i < 6; i++) {
    it(`--layer-tag-${i} holds 3:1 on paper, the active row and the hover row`, () => {
      const tag = rgb(token(editorUi, `layer-tag-${i}`));
      for (const [where, bg] of Object.entries(backgrounds)) {
        expect({ where, ratio: ratio(tag, bg) >= 3 }).toEqual({ where, ratio: true });
      }
    });
  }
});
