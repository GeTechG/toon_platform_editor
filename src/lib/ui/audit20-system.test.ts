import { describe, expect, it } from 'bun:test';

// Twentieth audit, the small screens and the shared system. Read as source,
// like audit19-system: the sums are in the comments, measured in Chrome with
// a coarse pointer at 1024×768 (the arrange mode) and on the phone sizes.
const UI = new URL('./', import.meta.url).pathname;
const shell = await Bun.file(UI + 'Editor.svelte').text();
const tokens = await Bun.file(UI + 'tokens.css').text();
const audioUi = await Bun.file(UI + 'AudioPanel.svelte').text();
const transformUi = await Bun.file(UI + 'TransformMenu.svelte').text();
const canvasUi = await Bun.file(UI + 'CanvasView.svelte').text();
const rule = (selector: string, from: string) => {
  const at = from.indexOf(`${selector} {`);
  return at < 0 ? '' : from.slice(at, from.indexOf('}', at));
};

describe('a wide handle keeps its contents’ height in a column that is short', () => {
  // The nineteenth audit gave the wide handle `min-height: var(--key-h)` so
  // an empty «Сохранено» could be taken. A written min-height replaces the
  // automatic one, and the column is a grid: at 1024×768 the brush handle's
  // row shrank to the 297 px the column had left, the 481 px brush box hung
  // centred out of it — 92 px up over the palette, 92 px down past the column.
  // The floor is a strut inside the handle now, so the automatic minimum
  // (the contents) stays.
  it('the floor is a strut, not a min-height on the handle', () => {
    expect(rule('.editor.arranging .arr.wide', shell)).not.toMatch(/min-height/);
    const strut = rule('.editor.arranging .arr.wide::before', shell);
    expect(strut).toMatch(/content:\s*''/);
    expect(strut).toMatch(/height:\s*var\(--key-h\)/);
    // The handle's flex gap must not push the contents off the frame.
    expect(strut).toMatch(/margin-inline-end:\s*-0\.3rem/);
  });
});

describe('the edge’s contrast is the one that is measured', () => {
  // #0b0c10 at 0x7a/255 over #ffffff is 3.417:1, over #eaeef7 3.315:1; the
  // comment and DESIGN.md said 3.45 and 3.32.
  it('tokens.css and DESIGN.md name 3.42 and 3.31', async () => {
    // DESIGN.md is the site's: the package checked out alone has none.
    const design = Bun.file(UI + '../../../../DESIGN.md');
    for (const text of [tokens, ...((await design.exists()) ? [await design.text()] : [])]) {
      const edge = text.slice(text.search(/48\s?%/));
      expect(edge.slice(0, 400)).toMatch(/3\.42:1/);
      expect(edge.slice(0, 400)).toMatch(/3\.31:1/);
    }
    expect(tokens).not.toContain('3.32:1');
  });
});

describe('the canvas hint keeps its words inside its pill', () => {
  // 320×568 at 200 % text, «Трансформация» on an empty frame: the pill is
  // 176 px on the 200 px stage and «трансформировать» alone is 236 px at
  // 26 px text. The word hung out of both sides of the pill, cut by the
  // stage's edges, and the thickness rail (drawn after it) lay over what was
  // left of the line's start.
  const hint = rule('\n  .hint', canvasUi);
  it('a word wider than the pill breaks', () => {
    expect(hint).toMatch(/overflow-wrap:\s*anywhere/);
  });
  it('the corners do not cut a line’s ends when the pill is many lines tall', () => {
    expect(hint).toMatch(/border-radius:\s*var\(--r-xl\)/);
  });
  it('the pill is drawn over the rail, and still lets the finger through', () => {
    expect(hint).toMatch(/z-index:\s*1;/);
    expect(hint).toMatch(/pointer-events:\s*none/);
  });
});

describe('the transform window does not scroll sideways', () => {
  // 320×568 at 200 % text: the window is 168 px on the 200 px stage and its
  // keys are 88. The row of four (two flips, two steps) asked 387 px and the
  // zoom row 285; the window scrolled 405 px sideways with «Применить» the
  // only key in sight, and «Трансформация» itself was cut at «Трансформ».
  // Only there: the desktop's 13rem window squeezes its four keys into one
  // row, and wrapping everywhere made it two.
  it('a row of keys wraps where the window is narrow', () => {
    expect(rule('\n  .row', transformUi)).not.toMatch(/flex-wrap/);
    expect(transformUi).toMatch(/@container transform \(width < 10rem\) \{\s*\.row \{\s*flex-wrap:\s*wrap/);
  });
  // «Масштаб X, %» is 174 px there and does not wrap: its field was 14 px
  // wide, past the window's edge.
  it('the labels go over their fields where the window is narrow', () => {
    expect(rule('\n  .transform-menu', transformUi)).toMatch(/container:\s*transform \/ inline-size/);
    const narrow = transformUi.slice(transformUi.indexOf('@container transform (width < 10rem)'));
    expect(narrow.slice(0, 200)).toMatch(/\.fields \{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(narrow.slice(0, 200)).toMatch(/white-space:\s*normal/);
  });
  it('«Применить» and the box’s label stay inside it too', () => {
    const narrow = transformUi.slice(transformUi.indexOf('@container transform (width < 10rem) {\n    .row'));
    const block = narrow.slice(0, narrow.indexOf('\n  }\n'));
    expect(block).toMatch(/\.row \.key \{\s*padding-inline:\s*0\.3rem/);
    expect(block).toMatch(/\.check \{\s*overflow-wrap:\s*anywhere/);
  });
  it('the title breaks rather than run out of the window', () => {
    expect(rule('\n  .title', transformUi)).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe('the save status does not widen the tab window', () => {
  // «сохранено локально 12:34 · 144 КБ» is one unbreakable line, 458 px at
  // 200 % text. In the «⋯» window after the first save it made the window
  // scroll sideways: 482 px in 200 on a phone standing up, in 397 lying down.
  it('it wraps there, and never asks more than the window', () => {
    const saved = rule('.tab-window > :global(.saved)', shell);
    expect(saved).toMatch(/white-space:\s*normal/);
    expect(saved).toMatch(/min-width:\s*0/);
  });
});

describe('the sound window with a track in it does not scroll sideways', () => {
  // 320×568 at 200 % text: the plate is 104 px. «Привязать к кадрам» and its
  // switch stood on one line — the words 145 px (they do not break), the
  // switch 83 — and the switch was 27 px past the screen's edge, in a window
  // scrolling 310 px sideways. The words take the line where they fit beside
  // the switch (8 rem and up) and one of their own where they do not.
  it('the words give the switch a line of its own when both do not fit', () => {
    expect(rule('\n  .toggle', audioUi)).toMatch(/flex-wrap:\s*wrap/);
    const words = rule('\n  .toggle > span', audioUi);
    expect(words).toMatch(/flex:\s*1 1 8rem/);
    expect(words).toMatch(/min-width:\s*0/);
    expect(words).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe('a draft keeps its picture at any text size', () => {
  // 320×568 at 200 % text: the date and the size beside the 44 px still do
  // not break narrower than their longest word, and the still — the flex
  // item that could shrink — gave way to 16 px: a sliver of a drawing the
  // list is told apart by. The words give way instead.
  it('the still does not shrink; the words do', () => {
    expect(rule('\n  .draft-thumb', shell)).toMatch(/flex:\s*none/);
    const meta = rule('\n  .draft-meta', shell);
    expect(meta).toMatch(/min-width:\s*0/);
    expect(meta).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
