import { describe, expect, it } from 'bun:test';
import { Glob } from 'bun';

// Five sheets, three of them right. Settings, plugins and export open as native
// `<dialog>` with `showModal()`, which brings the focus trap, the Esc key and an
// inert page behind them for free (WCAG 2.1.2, 2.4.3). Drafts and the shortcut
// list were hand-rolled beside them: a `<div role="dialog" aria-modal="true">`
// with no trap and no focus moved into it, and an Esc handler bound to a
// backdrop that is `tabindex="-1"` and therefore never receives a key — so Esc
// did nothing at all. The backdrop also announced itself `role="button"` while
// being unreachable. `aria-modal` is a promise; these two did not keep it.
const UI = new URL('./', import.meta.url).pathname;

async function sheets(): Promise<{ file: string; text: string }[]> {
  const out: { file: string; text: string }[] = [];
  for await (const file of new Glob('*.svelte').scan(UI)) {
    const text = await Bun.file(UI + file).text();
    if (text.includes('class="sheet"') || text.includes('sheet-dialog')) {
      out.push({ file, text });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

const found = await sheets();

describe('a sheet is a dialog', () => {
  it('no sheet claims modality it does not implement', () => {
    const handRolled = found
      .filter(({ text }) => /<div[^>]*\brole="dialog"/s.test(text))
      .map(({ file }) => file);
    expect(handRolled).toEqual([]);
  });

  it('no backdrop pretends to be a button', () => {
    const fake = found.filter(({ text }) => text.includes('sheet-backdrop')).map(({ file }) => file);
    expect(fake).toEqual([]);
  });

  it('every sheet opens as a native modal', () => {
    const notModal = found
      .filter(({ text }) => !text.includes('showModal()'))
      .map(({ file }) => file);
    expect(notModal).toEqual([]);
  });
});

// The Signal Rule (DESIGN.md): one `.key.primary` on a screen. Export showed a
// red «Скачать» over a red «Готово», settings three red keys, the catalog a red
// «Установить» on every row. Editor.svelte is left out: it holds the rail and
// two sheets, one primary each.
describe('a sheet has one red key', () => {
  it('no sheet carries more than one primary', () => {
    const loud = found
      .filter(({ file }) => file !== 'Editor.svelte')
      // A primary put on by a directive counts too: the plugins window lit
      // its picked tab red beside a red «Готово».
      .map(({ file, text }) => ({ file, n: text.match(/class="key[^"]*\bprimary\b|class:primary=/g)?.length ?? 0 }))
      .filter(({ n }) => n > 1);
    expect(loud).toEqual([]);
  });
});

// Eighth audit, 320 px and 200 % text. A `<dialog>` is `width: fit-content`
// by the browser's own sheet, so the phone sheet, pinned `left: 0; right: 0`,
// still grew to its widest line: settings 691 px on a 320 screen (the catalog
// address field alone asked 607), drafts 323 px at plain 100 % text — the
// close key went off the edge.
const editorUi = found.find(({ file }) => file === 'Editor.svelte')!.text;
const settings = found.find(({ file }) => file === 'SettingsSheet.svelte')!.text;
const pluginsUi = found.find(({ file }) => file === 'PluginsSheet.svelte')!.text;
const exportUi = found.find(({ file }) => file === 'ExportSheet.svelte')!.text;

/** The body of the first rule whose selector is exactly `selector`. */
function rule(text: string, selector: string): string {
  const at = text.indexOf(`${selector} {`);
  expect(at).toBeGreaterThan(-1);
  return text.slice(at, text.indexOf('}', at));
}

describe('a sheet is never wider than the screen', () => {
  it('the phone sheet takes the screen width, not its content width', () => {
    expect(rule(editorUi, '.editor :global(.sheet)')).toMatch(/width:\s*auto/);
  });

  it('a long word breaks rather than widening the body', () => {
    expect(rule(editorUi, '.editor :global(.sheet-body)')).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('the catalog address field shrinks to its column', () => {
    expect(rule(settings, '.field input')).toMatch(/min-width:\s*0/);
  });

  it('a row whose control does not fit beside its name puts it below', () => {
    expect(rule(settings, '.row')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule(settings, '.slider input')).toMatch(/min-width:\s*0/);
  });

  it('a draft row lets its keys go under the date', () => {
    expect(rule(editorUi, '.draft')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule(editorUi, '.draft-date')).not.toMatch(/white-space:\s*nowrap/);
  });

  it('the three draft keys wrap as one group, not one by one', () => {
    expect(editorUi).toMatch(/<span class="draft-keys">[^]*copyDraft[^]*downloadDraft[^]*removeDraft[^]*<\/span>\s*<\/li>/);
  });

  it('a sheet title breaks rather than running under its close key', () => {
    expect(rule(editorUi, '.editor :global(.sheet-head h2)')).toMatch(/min-width:\s*0/);
  });
});

describe('what a sheet says back is seen and heard', () => {
  it('the report region is mounted before its words, in the foot where it is seen', () => {
    for (const text of [settings, pluginsUi]) {
      expect(text).not.toContain('{#if report}');
      expect(text).toMatch(/<footer class="sheet-foot">[^]*role="status"[^]*<\/footer>/);
    }
  });

  it('the catalog says it is reading, not that it is empty, while it reads', () => {
    expect(pluginsUi).toContain("t('plugins.catalog_loading')");
  });
});

describe('a sheet section is a heading (WCAG 1.3.1)', () => {
  it('settings and export name their sections with headings', () => {
    for (const text of [settings, exportUi]) {
      expect(text).not.toContain('<p class="sheet-hint">');
      expect(text).toContain('<h3 class="sheet-hint">');
    }
  });
});

describe('the plugin face does not reach the close key', () => {
  it('the face rule is not the `.icon` every icon key wears', () => {
    expect(pluginsUi).not.toMatch(/^\s*\.icon :global\(svg\)/m);
  });
});
