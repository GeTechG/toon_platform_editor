import { describe, expect, it } from 'bun:test';
import { Glob } from 'bun';
import { i18n } from '../i18n-core';
import { formatFileSize } from './file-size';

// Fifteenth audit, the small screens and the shared system. Asserted as
// source, like audit14-system: the browsers and the phones are not in the run.
const UI = new URL('./', import.meta.url).pathname;
const LIB = new URL('../', import.meta.url).pathname;
const editorUi = await Bun.file(UI + 'Editor.svelte').text();
const icon = await Bun.file(UI + 'Icon.svelte').text();
const rule = (selector: string, from = editorUi) => {
  const at = from.indexOf(`${selector} {`);
  return at < 0 ? '' : from.slice(at, from.indexOf('}', at));
};

/** Every component's and sheet's CSS, comments out. */
async function styles(): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  for await (const path of new Glob('**/*.{svelte,css}').scan(LIB)) {
    let css = await Bun.file(LIB + path).text();
    if (path.endsWith('.svelte')) {
      const open = css.indexOf('<style');
      if (open < 0) continue;
      css = css.slice(css.indexOf('>', open) + 1, css.indexOf('</style>'));
    }
    out.push([path, css.replace(/\/\*[\s\S]*?\*\//g, '')]);
  }
  return out.sort(([a], [b]) => a.localeCompare(b));
}

describe('a size is written in the interface’s language', () => {
  // The comma was written in by hand: a translation kept «1,5 KB».
  it('the decimal mark is the locale’s', async () => {
    expect(formatFileSize(1536)).toBe('1,5 КБ');
    await i18n.changeLanguage('en');
    try {
      expect(formatFileSize(1536)).toMatch(/^1\.5 /);
      expect(formatFileSize(1023)).toMatch(/^1023 /);
    } finally {
      await i18n.changeLanguage('ru');
    }
  });
});

describe('the studio says which language its words are in', () => {
  // Embedded in a page of another language, a reader read the Russian labels
  // with that page's voice, and `hyphens: auto` broke them by its rules.
  it('the root carries the catalogue’s locale', () => {
    expect(editorUi).toMatch(/class="editor studio"\n  lang=\{dateLocale\(\)\}/);
  });
});

describe('the tab words come back once they fit', () => {
  // The tab's sides went to 0.1 rem (audit 14), the hidden words stayed laid
  // out 0.25 rem in from each side: measured 0.3 rem narrower than they would
  // show, a word that fit again was still called too wide, and the tabs kept
  // only their icons after a turn or a smaller text.
  it('the hidden word is laid out across the width the shown one has', () => {
    const side = rule('.tab').match(/padding:\s*\S+\s+(\S+);/)?.[1];
    expect(side).toBeTruthy();
    const bare = rule('.tabs.bare .tab-label');
    expect(bare).toContain(`left: ${side};`);
    expect(bare).toContain(`right: ${side};`);
  });
});

describe('the window lying down does not cover the zoom window', () => {
  // 740×360: the tab window comes in from the right over the whole height,
  // and the zoom window sits in the top right corner — under it, its keys
  // still in the Tab order (WCAG 2.4.11). It steps aside, as it does for the
  // transform window; a pinch zooms meanwhile.
  it('the stage says a side window is up, and the zoom window goes', () => {
    expect(editorUi).toMatch(/class:side-window=\{!!shownTab && !tall\}/);
    expect(rule('.studio.compact .stage.side-window > .scale-window')).toMatch(/display:\s*none/);
  });
});

describe('an icon name the vocabulary lacks still draws something', () => {
  // A plugin tool with `icon: "star"` (a word, not markup) drew an empty key:
  // `PATHS["star"]` is undefined and the path had no `d`.
  it('falls back to a glyph of its own', () => {
    expect(icon).toContain('Object.hasOwn(PATHS, name) ? PATHS[name as IconName] : FALLBACK');
    expect(icon).toMatch(/const FALLBACK = '[^']+'/);
  });
});

describe('a tap does not leave a key tinted', () => {
  // A touch «hover» sticks after a tap: a tab closed again, the onion skin
  // switched off, a primary key — each kept its hover tone until the next
  // tap somewhere else, and read as still pressed.
  it('the hover tones of the keys and the tabs are for a pointer that hovers', () => {
    const hovering = [...editorUi.matchAll(/@media \(hover: hover\) \{([^]*?)\n {2}\}/g)].map((m) => m[1]).join('\n');
    for (const selector of [
      '.tab:hover',
      '.editor :global(.key:hover:not(:disabled))',
      '.editor :global(.key.active:hover:not(:disabled))',
      '.editor :global(.key.primary:hover:not(:disabled))',
    ]) {
      expect(hovering).toContain(`${selector} {`);
      const outside = editorUi.replace(/@media \(hover: hover\) \{[^]*?\n {2}\}/g, '');
      expect(outside).not.toContain(`${selector} {`);
    }
  });
});

describe('Safari 16.0 and 16.1 see the tints', () => {
  // `color-mix()` is Safari 16.2. With a `var()` in it the declaration is not
  // thrown away at parse time: it is invalid when computed, and the property
  // goes to its initial value — the picked key, the selected cells and the
  // active layer lost their wash to `transparent`. A fallback declaration
  // before it does not help; a rule under `@supports not` does.
  it('every file that mixes colours carries a fallback for a browser without it', async () => {
    const missing = (await styles())
      .filter(([, css]) => /color-mix\(/.test(css))
      .filter(([, css]) => !/@supports not \(color: color-mix\(in srgb, red, red\)\)/.test(css))
      .map(([path]) => path);
    expect(missing).toEqual([]);
  });
});

describe('prefixes the supported browsers still need', () => {
  it('`hyphens` has its `-webkit-` twin: Safari hyphenates unprefixed from 17', async () => {
    const found = (await styles()).flatMap(([path, css]) =>
      [...css.matchAll(/(^|[^-])hyphens:\s*auto/g)].length > [...css.matchAll(/-webkit-hyphens:\s*auto/g)].length ? [path] : [],
    );
    expect(found).toEqual([]);
  });
  it('`mask-image` has its `-webkit-` twin: Chrome masks unprefixed from 120, the site targets 111', async () => {
    const found = (await styles()).flatMap(([path, css]) =>
      [...css.matchAll(/(^|[^-])mask-image:/g)].length > [...css.matchAll(/-webkit-mask-image:/g)].length ? [path] : [],
    );
    expect(found).toEqual([]);
  });
});

describe('the stacking order is the table’s', () => {
  // The brush types without popover (Safari 16) stood at z-index 50, over the
  // sheets (11) and the menus (41) the table orders.
  it('the brush types’ fallback list takes the menu rung', async () => {
    const brush = await Bun.file(UI + 'BrushPanel.svelte').text();
    expect(rule('.types.fallback', brush)).toMatch(/z-index:\s*var\(--z-menu\)/);
  });
});
