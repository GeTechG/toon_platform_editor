import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';

// Icon.svelte is the editor's whole icon vocabulary — one ink line, 24-unit
// grid. A control labelled with a typeface glyph (⏵, ⇄, −) is not in it: it
// renders in whatever font the system hands over, at whatever weight, and
// sits beside the drawn icons looking like a different product.
const UI = new URL('.', import.meta.url).pathname;

/** A control whose whole label is punctuation — the glyph-as-icon shape. */
const GLYPH_LABEL = />\s*[^<>{}\w\s]{1,3}\s*<\/(?:button|span|div)>/g;

async function glyphControls(): Promise<string[]> {
  const found: string[] = [];
  for await (const file of new Glob('*.svelte').scan(UI)) {
    const source = await Bun.file(UI + file).text();
    for (const hit of source.matchAll(GLYPH_LABEL)) {
      found.push(`${file}: ${hit[0]}`);
    }
  }
  return found.sort();
}

describe('the icon vocabulary', () => {
  test('no control is labelled with a bare glyph instead of an icon', async () => {
    expect(await glyphControls()).toEqual([]);
  });

  test('every name in IconName has a path', async () => {
    const source = await Bun.file(UI + 'Icon.svelte').text();
    const names = [...source.matchAll(/^\s*\| '([a-z-]+)'$/gm)].map((m) => m[1]);
    const paths = [...source.matchAll(/^\s*'?([a-z-]+)'?:\s*$|^\s*'?([a-z-]+)'?:\s*'/gm)].map(
      (m) => m[1] ?? m[2],
    );

    expect(names.length).toBeGreaterThan(20);
    expect(names.filter((name) => !paths.includes(name))).toEqual([]);
  });
});
