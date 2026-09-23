import { describe, expect, it } from 'bun:test';
import { Glob } from 'bun';

// The catalogue only holds the text if nothing keeps a copy at home. This
// walks the sources and fails on any Russian left outside `lib/i18n/ru.json` —
// the one check that keeps the next tool's label from being typed straight
// into the markup again.
const SRC = new URL('../', import.meta.url).pathname;
const CYRILLIC = /[А-Яа-яЁё]/;
// Fixtures are document data, not interface: a layer named «Фон» in a saved
// file is the user's own word, and the bench corpus is a drawing, not a screen.
const SKIP = /(\.test\.ts$|^lib\/format\/fixtures\/|^bench\/)/;

/** The lines a reader could actually see: comment lines dropped, code kept.
 *
 *  Line-based on purpose. A regex that pairs an opening `/*` with the next
 *  closer across the whole file reads `accept="audio/*"` as the start of a
 *  comment and goes silent until the CSS — which is how a whole panel of text
 *  hid from this check. A comment starts a line; an attribute value does not. */
function visibleLines(source: string): string[] {
  const out: string[] = [];
  let closer: RegExp | null = null;
  for (const raw of source.split('\n')) {
    if (closer) {
      if (closer.test(raw)) closer = null;
      out.push('');
      continue;
    }
    const line = raw.trim();
    if (line.startsWith('*') || line.startsWith('//')) {
      out.push('');
      continue;
    }
    if (line.startsWith('/*') || line.startsWith('<!--')) {
      const end = line.startsWith('/*') ? /\*\// : /-->/;
      if (!end.test(line.slice(2))) closer = end;
      out.push('');
      continue;
    }
    // A comment that follows code on its own line, and inline pairs that both
    // open and close here. `https://` is not one: a comment needs the space.
    out.push(raw.replace(/\/\*[^*]*\*\//g, '').replace(/(^|\s)\/\/.*$/, ''));
  }
  return out;
}

async function strays(): Promise<string[]> {
  const found: string[] = [];
  for await (const file of new Glob('**/*.{ts,svelte}').scan(SRC)) {
    if (SKIP.test(file)) continue;
    const lines = visibleLines(await Bun.file(SRC + file).text());
    lines.forEach((line, i) => {
      if (CYRILLIC.test(line)) found.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  return found;
}

describe('visible text lives in the dictionary', () => {
  it('no Russian outside lib/i18n/ru.json', async () => {
    expect(await strays()).toEqual([]);
  });
});

// Tenth audit: one word per thing, and no slips a reader trips on.
describe('the dictionary says one thing one way', async () => {
  const ru = await Bun.file(new URL('./i18n/ru.json', import.meta.url).pathname).json();
  const all = JSON.stringify(ru);

  it('a saved panel layout is a «раскладка», never a «рабочее пространство»', () => {
    // The bar, the phone key and the save title said «раскладка»; the picker
    // beside them said «рабочее пространство» for the same list.
    expect(all).not.toMatch(/рабоч\S* пространств|выбранное пространство/i);
  });

  it('the two colour wells are named контур and заливка everywhere', () => {
    // The palette called them «контур» / «заливка»; the colour window called
    // the same two wells «цвет кисти» and «цвет правой кнопки».
    expect(ru.color.stroke_title).toContain('контур');
    expect(ru.color.fill_title).toContain('заливк');
  });

  it('a plugin for another API version is told in words, not «чужой мажор»', () => {
    expect(all).not.toContain('мажор');
    expect(ru.plugin.foreign_api).toContain('{{api}}');
    expect(ru.plugin.catalog_foreign_major).toContain('{{api}}');
  });

  it.each([
    ['Тониовская', 'the toonio brush is «Туниовская», like «Тунио» in the file errors'],
    ['видео-кодек', '«видеокодек» is one word'],
    ['дрожь руки почти не видно', '«не видно» takes the genitive: «дрожи»'],
  ])('no «%s» — %s', (slip) => {
    expect(all).not.toContain(slip);
  });
});
