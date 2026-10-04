import { describe, expect, it } from 'bun:test';

// Twenty-first audit, the small screens and the shared system. Read as
// source, like audit20-system: the sums in the comments were measured in
// Chrome — the keyboard pass at 1440×900, forced colors emulated.
const UI = new URL('./', import.meta.url).pathname;
const tokens = await Bun.file(UI + 'tokens.css').text();
const controls = await Bun.file(UI + 'controls.css').text();

describe('the focus ring is whole on a key at the edge of what scrolls', () => {
  // The ring stands 5 px outside its key (3 px wide, 2 px off). Tab scrolls
  // the next key just into view — flush with the scroller's edge — and the
  // scroller cut that side of the ring off: «Сохранить сейчас» in the
  // settings sheet and the last row of the brush box (10 px short of its
  // column at 1440×900) showed three sides of four.
  const at = tokens.indexOf('scroll-padding');
  const rule = tokens.slice(tokens.lastIndexOf('\n:where(.editor)', at), tokens.indexOf('}', at));
  it('what scrolls keeps the ring’s room when it brings the focus into view', () => {
    expect(at).toBeGreaterThan(0);
    expect(rule).toMatch(/scroll-padding:\s*6px/);
  });
  it('the sheets, the columns, the boxes, the tab window and the bar', () => {
    for (const scroller of ['.sheet-body', '.sheet-dialog', '.box', '.tab-window', '.left', '.right', '.toolbar', '.audio-plate']) {
      expect(rule).toContain(scroller);
    }
  });
  it('offers, like the ring itself: zero specificity', () => {
    expect(rule).toMatch(/^\n:where\(\.editor\) :where\(/);
  });
});

describe('a key has an edge in forced colors', () => {
  // The mode paints every surface one colour, and a key's only boundary was
  // its fill (`border: none`): «Скачать палитры», «Готово», the formats of
  // the export sheet stood as bold words among the labels, the tools as bare
  // glyphs. An outline, not a border: nothing moves. The focus ring is the
  // same property, so the edge steps aside for it.
  const forced = controls.slice(controls.indexOf('@media (forced-colors: active)'));
  it('the key is outlined in the system’s button colour, inside its own box', () => {
    const at = forced.indexOf(':where(.key):not(:focus-visible)');
    expect(at).toBeGreaterThan(0);
    const rule = forced.slice(at, forced.indexOf('}', at));
    expect(rule).toMatch(/outline:\s*1px solid ButtonText/);
    expect(rule).toMatch(/outline-offset:\s*-1px/);
  });
});

describe('«Экспорт» says it opens a window, like the other three sheets', () => {
  // «Справка», «Настройки» and «Черновики» carry `aria-haspopup="dialog"`
  // (17th audit); the fourth key that opens a modal sheet did not, and a
  // reader announced it as a plain action.
  it('the key carries aria-haspopup="dialog"', async () => {
    const shell = await Bun.file(UI + 'Editor.svelte').text();
    const at = shell.indexOf("{:else if id === 'export'}");
    expect(shell.slice(at, shell.indexOf('{:else if', at + 10))).toMatch(/aria-haspopup="dialog"/);
  });
});
