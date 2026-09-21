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
