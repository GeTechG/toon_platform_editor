import { describe, expect, it } from 'bun:test';
import { Glob } from 'bun';

// Four rules of the shipped package that nothing else holds. The site has its
// own copy of this file (`apps/web/src/lib/shell-craft.test.ts`); the editor
// had none, and every one of these drifted in the gap: the shadow vocabulary,
// the modal scrim, the focus ring, and a Named Rule about red.
const UI = new URL('./', import.meta.url).pathname;

async function sheets(): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for await (const file of new Glob('**/*.{svelte,css}').scan(UI)) {
    const text = await Bun.file(UI + file).text();
    const style = file.endsWith('.css') ? text : text.match(/<style>([\s\S]*)<\/style>/)?.[1];
    if (style) {
      found.set(file, style);
    }
  }
  return found;
}

/** A rule this file explains is not a rule this file breaks. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const STYLES = await sheets();
const tokensCss = await Bun.file(UI + 'tokens.css').text();
const editorUi = await Bun.file(UI + 'Editor.svelte').text();

// DESIGN §4 writes the whole vocabulary: a plate that floats, a menu that drops,
// a sheet that slides up, and the mascot's own landing shadow. The editor was
// carrying eleven soft shadows in seven recipes, five of them pure black under
// a blue-tinted shadow language — and in every file the right one was a few
// lines away. A hard offset with no blur is not a shadow: the key's travel, an
// inset ring and the focus ring are boundaries, and they stay literal.
describe('a soft shadow comes from the vocabulary', () => {
  /** Every `box-shadow` value in the package, with the file it sits in. */
  function shadows(): { file: string; value: string }[] {
    const out: { file: string; value: string }[] = [];
    for (const [file, css] of STYLES) {
      for (const [, value] of withoutComments(css).matchAll(/box-shadow:\s*([^;}]+)/g)) {
        out.push({ file, value: value.trim() });
      }
    }
    return out;
  }

  /** A layer is soft when it has a blur radius of its own. */
  function isSoft(layer: string): boolean {
    const lengths = layer.match(/-?[\d.]+(?:px|rem|em)/g) ?? [];
    return lengths.length >= 3 && parseFloat(lengths[2]) !== 0;
  }

  it('writes no soft shadow as a literal recipe', () => {
    const literal = shadows()
      .filter(({ value }) => value.split(/,(?![^(]*\))/).some((layer) => isSoft(layer)))
      .filter(({ value }) => !value.includes('var(--shadow-'))
      .map(({ file, value }) => `${file}: ${value}`);
    expect([...new Set(literal)].sort()).toEqual([]);
  });

  it('shadows the sheet by the shape it has on the screen it is on', () => {
    // One element, two shapes. On a phone it rises from the bottom edge, where
    // a downward shadow falls off the screen and only the upward one separates
    // it from the table. On a wider screen the same element is a card centred
    // over the scrim — it floats, and an upward-only lift leaves it standing on
    // nothing while every other floating surface in the editor drifts down-right.
    const centred = editorUi.slice(
      editorUi.lastIndexOf('.editor :global(.sheet) {', editorUi.indexOf('width: min(24rem')),
      editorUi.indexOf('}', editorUi.indexOf('width: min(24rem')),
    );
    expect(centred).toContain('box-shadow: var(--shadow-plate)');
  });

  it('declares the vocabulary in the file both packages read', () => {
    // The site declared these and the editor could not see them, which is how
    // eleven literals happened. The lower package owns the table (see
    // `tokens.test.ts`), so it owns the shadows in it too.
    expect(tokensCss).toContain('--shadow-plate:');
    expect(tokensCss).toContain('--shadow-menu:');
    // A sheet rises from the bottom edge, where a downward shadow falls off
    // the screen. DESIGN §4 names it.
    expect(tokensCss).toContain('--shadow-sheet:');
  });
});

describe('the scrim under a modal is a token', () => {
  it('is written once, not in every sheet that opens one', () => {
    expect(tokensCss).toContain('--scrim:');
    const copies = [...STYLES]
      .filter(([file]) => file !== 'tokens.css')
      .filter(([, css]) => /rgba\(\s*11\s*,\s*12\s*,\s*16/.test(withoutComments(css)))
      .map(([file]) => file);
    expect(copies.sort()).toEqual([]);
  });
});

// The ring came from the site's app.css. Everything the package exports —
// `.`, `./icon`, `./player` — renders wherever it is mounted, and PRODUCT.md
// calls that openness one of the two differentiators: a host that is not
// `apps/web`, including this package's own dev host, got the browser default.
describe('the package carries its own focus ring', () => {
  it('ships a ring beside the tokens', () => {
    expect(tokensCss).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--electric\)/s);
    // Same zero specificity as the table above it, and inside the editor only:
    // the file offers its look to a host, it does not paint the host's page.
    expect(tokensCss).toMatch(/:where\([^)]*\)\s+:focus-visible/);
  });

  it('never drops the outline without drawing the ring itself', () => {
    // A seam 1px wide cannot wear an outline — a halo around a hairline is
    // invisible, so it thickens and lights up instead, and that is a legal
    // `outline: none`. The audio field dropped the ring for a 1px border tint,
    // a quarter of what every other field in the system promises, and won on
    // specificity rather than on a decision.
    const naked: string[] = [];
    for (const [file, css] of STYLES) {
      for (const [, selector, body] of withoutComments(css).matchAll(
        /([^{}]+)\{([^{}]*outline:\s*none[^{}]*)\}/g,
      )) {
        // Paint or a thicker line, not a recolour: the audio field swapped the
        // ring for `border-color` on the 1px line it already had.
        if (!/background|box-shadow|border-width|border:/.test(body)) {
          naked.push(`${file}: ${selector.trim()}`);
        }
      }
    }
    expect(naked.sort()).toEqual([]);
  });
});

// The Signal Rule reserves red for «рисовать» and bans it on icons and borders
// by name. The mascot's facets get a written carve-out in DESIGN §2 because
// they are paint inside a drawing; a layer tag is interface chrome and gets
// none, so it may not sit in the signal hue.
describe('no layer tag wears the signal red', () => {
  /** Hue in degrees, 0–360. */
  function hue(hex: string): number {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    if (delta === 0) return 0;
    const h = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return ((h * 60) % 360 + 360) % 360;
  }

  it('keeps every tag clear of the signal band', () => {
    const signal = hue('#ff4326');
    const distance = (h: number) => Math.min(Math.abs(h - signal), 360 - Math.abs(h - signal));
    const tags = [...`${tokensCss}\n${[...STYLES.values()].join('\n')}`.matchAll(
      /--layer-tag-\d+:\s*(#[0-9a-f]{6})/gi,
    )].map((m) => m[1]);
    expect(tags.length).toBe(6);
    expect(tags.filter((hex) => distance(hue(hex)) < 25)).toEqual([]);
  });
});

describe('a draft thumbnail reserves its box', () => {
  it('states both sides so the list does not reflow behind the blob', () => {
    // The record carries the document, so the box is the same `fitThumb` the
    // sibling `FrameThumb` branch already uses — not a guess.
    const tag = editorUi.match(/<img[^>]*thumbUrls[^>]*>/)?.[0] ?? '';
    expect(tag).toContain('width=');
    expect(tag).toContain('height=');
  });
});
