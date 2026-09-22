import { describe, expect, it } from 'bun:test';

// The floor DESIGN §5 sets and the floor the studio was keeping are not the
// same number. The Dense-Timeline Rule reads «Пол 44 px держат клавиши и всё,
// что стоит вне монтажной области», and writes its exemption for the montage
// grid alone — the frame cell, the layer row and the switches inside it, where
// 44px on a 390px screen leaves eight frames of twenty-four and target size is
// bought with the document's own visibility.
//
// A floating tool window is not the montage. The zoom window, the palette, the
// brush panel and the transform window stand over the canvas, show nothing row
// by row and crowd out no frame. Measured on 390×844 before this was fixed,
// sixteen controls outside the timeline sat under the floor: 28px zoom keys,
// a 28px swap, 40px palette footer keys, a 32px brush trigger, three 24px
// sliders, two 24px info keys, 32px transform fields and keys. None of them
// broke WCAG 2.2 AA 2.5.8 — every one cleared 24 — and that is exactly how it
// happened: `TransformMenu.svelte` cited «WCAG 2.5.8: 24px» as its authority,
// and the standard is a floor under the product's floor, not a substitute for
// it. The three sliders are brush thickness, the most repeated movement in the
// editor, under a thumb.
const FLOOR = 44;

const WINDOWS = [
  'ScaleMenu.svelte',
  'PaletteBox.svelte',
  'BrushPanel.svelte',
  'TransformMenu.svelte',
  // The colour window is the fifth of its kind — a native `<dialog>` people
  // drag by its head — and it was the one the list forgot.
  'ColourPicker.svelte',
  // The colour panel stands in a toolbar row, not in the montage: its saved
  // swatches are chrome beside the keys, and the row is already a key tall.
  'ColorPanel.svelte',
  // The studio's own chrome, for the same reason: scoping this to the floating
  // windows alone left the fps slider in the bottom toolbar at 96x24.
  'Editor.svelte',
];

/** What a control is allowed to be smaller than the floor, and why. */
const EXEMPT = new Map<string, string>([
  // The reference palette grid: 35px cells edge to edge, six to a 225px box.
  // At 44 the grid alone is wider than the window that holds it. This is the
  // second dense grid in the product and DESIGN §5 names it beside the first.
  ['PaletteBox.svelte .cell', 'palette swatch grid — dense by the same argument as the timeline'],
  ['PaletteBox.svelte .micro', 'the swatch drawing inside the cell, not a target of its own'],
  // The thin things DESIGN §5 writes the pseudo-element clause for. Each is a
  // seam or a tab that would become a bar if drawn at 44, and each grows its
  // own press area; the sizes below are the drawing, not the target.
  ['Editor.svelte .resizer', 'the panel seam — 16px band, drawn as a line'],
  ['Editor.svelte .side-resizer', 'the column seam — 9px band, drawn as a line'],
  ['Editor.svelte .fold', 'the collapse tab — 44 on its long axis, a tab on its short one'],
  // The box is the drawing; the target is the `<label class="toggle">` around
  // it, which is `min-height: 2.9rem` (46.4) and carries the pointer cursor.
  // A 44px checkbox beside a one-line setting would be the setting.
  ['Editor.svelte .editor :global(.toggle input)', 'the row is the target, and the row clears the floor'],
  // Rearranging wraps each item in a handle that is the item plus 2px. The
  // item inside is the key, and the key clears the floor; the handle has no
  // size of its own to declare.
  ['Editor.svelte .editor.arranging .arr', 'the handle is the item plus 2px, and the item clears the floor'],
]);

const sheets = new Map<string, string>();
for (const file of WINDOWS) {
  const text = await Bun.file(new URL(`./${file}`, import.meta.url)).text();
  sheets.set(file, text.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? '');
}

type Rule = { selector: string; body: string };

/** Every top-level rule of a sheet, comments dropped, media blocks flattened. */
function rules(css: string): Rule[] {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
  const out: Rule[] = [];
  for (const [, selector, body] of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: selector.trim().replace(/\s+/g, ' '), body });
  }
  return out;
}

/** `44px`, `2.75rem`, `var(--key-h)` — anything that says how big a box is. */
function px(value: string): number | null {
  const v = value.trim();
  // The two names the floor has. Both are declared 44 and nothing else is.
  if (/var\(\s*--(key-h|tap)\s*[,)]/.test(v)) return FLOOR;
  const rem = v.match(/^([\d.]+)rem$/);
  if (rem) return Number(rem[1]) * 16;
  const abs = v.match(/^([\d.]+)px$/);
  if (abs) return Number(abs[1]);
  return null;
}

/** The smallest length this rule pins on each axis, if it pins one at all. */
function box(body: string): { h: number | null; w: number | null } {
  const of = (prop: string) => {
    const hit = body.match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`));
    return hit ? px(hit[1]) : null;
  };
  const least = (...vals: (number | null)[]) => {
    const real = vals.filter((v): v is number => v !== null);
    return real.length ? Math.min(...real) : null;
  };
  return { h: least(of('min-height'), of('height')), w: least(of('min-width'), of('width')) };
}

/**
 * Does this rule leave room above and below its content? Shorthand order is
 * top/right/bottom/left, so the first value and the third are the ones that
 * make a control taller than what is written in it. `padding: 0 10px` sizes
 * nothing vertically — the height comes from the row.
 */
function padsVertically(body: string): boolean {
  const hit = body.match(/(?:^|;|\s)padding\s*:\s*([^;]+)/);
  if (!hit) return false;
  const parts = hit[1].trim().split(/\s+/);
  const vertical = parts.length >= 3 ? [parts[0], parts[2]] : [parts[0]];
  // A bare `0` carries no unit, so `px` does not read it; every other
  // unreadable value is treated as room, which is the cautious direction.
  return vertical.some((v) => v !== '0' && (px(v) ?? 1) > 0);
}

/** The press area a thin control grows for itself, per DESIGN §5. */
function grownBox(all: Rule[], rule: Rule): { h: number | null; w: number | null } {
  return box(
    all
      .filter((r) => r.selector.split(',').some((one) => one.trim() === `${rule.selector}::after`))
      .map((r) => r.body)
      .join(';'),
  );
}

/** Does this rule draw something a person operates? */
function isControl({ selector, body }: Rule): boolean {
  if (/::(before|after|backdrop)|:focus|:hover|:active|:disabled|popover-open/.test(selector)) {
    return false;
  }
  if (/\b(button|input|select|textarea)\b/.test(selector)) return true;
  // `.key` and `.step` are the studio's own words for a button, and they are
  // drawn here but styled in `Editor.svelte`, so the cursor is not in this body.
  if (/\.(key|step)\b/.test(selector)) return true;
  return /cursor:\s*(pointer|grab|crosshair|ew-resize|ns-resize)/.test(body);
}

describe('a control outside the montage grid takes a finger', () => {
  it('pins no control below the floor', () => {
    const low: string[] = [];
    for (const [file, css] of sheets) {
      const all = rules(css);
      for (const rule of all) {
        if (!isControl(rule)) continue;
        const name = `${file} ${rule.selector}`;
        if ([...EXEMPT.keys()].some((k) => name.startsWith(k))) continue;
        const own = box(rule.body);
        // A thin thing may stay thin and grow its press area with a pseudo
        // element — DESIGN §5 says so in as many words — as long as the area
        // itself reaches the floor.
        const grown = grownBox(all, rule);
        for (const axis of ['h', 'w'] as const) {
          const pinned = own[axis];
          if (pinned !== null && pinned < FLOOR && (grown[axis] ?? 0) < FLOOR) {
            low.push(`${name} ${axis}=${pinned}`);
          }
        }
      }
    }
    expect(low).toEqual([]);
  });

  it('takes the floor from the token, not from a number that fits the window', () => {
    // A literal does not know it is a floor. The next tidy-up of the window
    // lowers it and nothing says a word.
    const literal: string[] = [];
    for (const [file, css] of sheets) {
      for (const rule of rules(css)) {
        if (!isControl(rule)) continue;
        for (const [, prop, value] of rule.body.matchAll(/(min-height|min-width)\s*:\s*([^;]+)/g)) {
          if (px(value) === FLOOR && !/var\(/.test(value)) {
            literal.push(`${file} ${rule.selector} ${prop}: ${value.trim()}`);
          }
        }
      }
    }
    expect(literal).toEqual([]);
  });
  it('declares the floor it stands on', () => {
    // The rule above catches a control that pins itself too small. It cannot
    // see one that pins nothing at all and takes the size of what is inside
    // it: the colour window's close button is a 16px icon in 0.2rem of
    // padding — 22px, under the floor and under the standard's own 24 — and
    // it declares no height for anything to compare.
    //
    // Padding is the tell. A control that sizes itself by the room it leaves
    // around its content has decided how big it is, and a decision that lands
    // at 22 is the one this file exists to catch. A control that takes its
    // height from elsewhere is not deciding here: `.key`/`.step` take it from
    // the studio sheet, a percentage takes it from the box around it, and a
    // thin thing takes its target from the pseudo element it grows.
    const silent: string[] = [];
    for (const [file, css] of sheets) {
      const all = rules(css);
      for (const rule of all) {
        if (!isControl(rule)) continue;
        if (/\.(key|step)\b/.test(rule.selector)) continue;
        if (!padsVertically(rule.body)) continue;
        if (/(^|;|\s)height\s*:\s*[\d.]+%/.test(rule.body)) continue;
        const name = `${file} ${rule.selector}`;
        if ([...EXEMPT.keys()].some((k) => name.startsWith(k))) continue;
        if (grownBox(all, rule).h !== null) continue;
        if ((box(rule.body).h ?? 0) < FLOOR) silent.push(name);
      }
    }
    expect(silent).toEqual([]);
  });
});
