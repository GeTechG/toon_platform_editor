import { describe, expect, it } from 'bun:test';

// Measured on a 360×732 phone before this was fixed: `.left` 119px, `.right`
// 379px, `.panel` 178px, and `.stage` — the only child that grows — **0**. The
// canvas still painted, outside its zero-height box, over the toolbar. There
// was nowhere to draw on a phone at all. The keys in the rail had lost their
// width the same way: `min-width: 0` from the desktop columns survived into the
// phone branch and nine tools split 360px into 17.2px slivers, 6.4px apart —
// closer than WCAG 2.2 AA 2.5.8 forgives even with the spacing exception.
//
// Both are a line of CSS each, and both are a line someone will tidy away. This
// is the note that says they are load-bearing.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

/** The body of the `@media` block that opens at `from`. */
function block(from: number): string {
  const open = editorUi.indexOf('{', from);
  let depth = 0;
  for (let i = open; i < editorUi.length; i++) {
    if (editorUi[i] === '{') depth++;
    if (editorUi[i] === '}' && --depth === 0) return editorUi.slice(open, i);
  }
  throw new Error('unterminated media block');
}

/** The phone branch of the studio stylesheet. */
function phoneBranch(): string {
  const start = editorUi.indexOf('/* Phone: no room for side columns');
  expect(start).toBeGreaterThan(-1);
  return block(editorUi.indexOf('@media (max-width: 40rem)', start));
}

/** Every phone branch there is — the studio has more than one. */
function phoneBranches(): string[] {
  return [...editorUi.matchAll(/@media \(max-width: 40rem\)/g)].map((m) => block(m.index!));
}

const phone = phoneBranch();

describe('a phone keeps room to draw', () => {
  it('the stage has a floor it does not give up', () => {
    expect(phone).toMatch(/\.studio \.stage \{[^}]*min-height:\s*\d+dvh/);
  });

  it('the rails are capped and scroll what does not fit', () => {
    expect(phone).toMatch(/\.studio \.right \{[^}]*max-height:\s*\d+dvh/);
    expect(phone).toMatch(/\.studio \.panel \{[^}]*max-height:\s*\d+dvh/);
    // Capping without a scroller would clip the palette instead of moving it.
    expect(phone).toMatch(/overflow:\s*auto/);
  });

  it('the bottom rail scrolls too, and stops leaking into the document', () => {
    // Measured on 390×844: left 114 + stage 321 + right 186 + panel 167 fills
    // the 788 exactly, and the panel wanted 177. It is `overflow: clip` with a
    // 20px clip margin — which exists so the fold tab and the resizer can paint
    // outside it — so the missing 10px painted past the studio and handed the
    // *document* a scrollbar: 855 against a 844 viewport. On a phone both of
    // those children are `display: none`, so the margin buys nothing and costs
    // a page that slides under a thumb meant for the canvas.
    expect(phone).toMatch(/\.studio \.panel \{[^}]*overflow:\s*auto/s);
    expect(phone).toMatch(/\.studio \.panel \{[^}]*overflow-clip-margin:\s*0/s);
  });

  it('a key keeps its finger-sized width in the rail', () => {
    expect(phone).toMatch(/:global\(\.key\)[^}]*min-width:\s*var\(--key-h\)/s);
  });
});

describe('the phone branch and the desktop branch do not overlap', () => {
  it('no breakpoint matches on both sides of the same edge', () => {
    // `max-width: 40rem` and `min-width: 40rem` both match at exactly 640px, so
    // a sheet took its desktop centring while the studio was still stacked. The
    // complement of `max-width: 40rem` is `min-width: 40.0625rem` — which one
    // rule already used and another did not.
    const phoneEdges = [...editorUi.matchAll(/@media \(max-width: ([\d.]+)rem\)/g)].map((m) => m[1]);
    const deskEdges = [...editorUi.matchAll(/@media \(min-width: ([\d.]+)rem\)/g)].map((m) => m[1]);
    expect(deskEdges.filter((edge) => phoneEdges.includes(edge))).toEqual([]);
  });
});

describe('a window that stops floating gets a row of its own', () => {
  // Measured on 390×844 before this was fixed: `.stage` ended at y=498.5 and
  // `.scale-window` — turned `position: static` by the branch below, but still
  // a child of a stage the canvas fills edge to edge — laid itself out at
  // y=506–540, outside its own parent, under the panel that comes next.
  // `elementFromPoint` across the whole «100 %» readout returned the palette,
  // the brush box and an <h2>; never the zoom window. It was in the tree, it
  // had geometry, and it could be neither seen nor pressed. The `z-index: 3`
  // left over from the floating layout does not help: a static element has none.
  //
  // Un-floating a child is only half a layout. The other half is the row it
  // now needs, and that row has to come out of the canvas.
  const branch = phoneBranches().find((b) => b.includes('.scale-window'));

  it('has a branch that un-floats the tool windows', () => {
    expect(branch).toBeDefined();
    expect(branch).toMatch(/position:\s*static/);
  });

  it('turns the stage into a column so the windows get rows', () => {
    expect(branch).toMatch(/\.stage \{[^}]*flex-direction:\s*column/s);
  });

  it('lets the canvas shrink instead of filling the stage', () => {
    // `.wrap` carries `height: 100%`, which in a column resolves against the
    // whole stage and pushes every sibling straight back out of it.
    expect(branch).toMatch(/\.stage > :global\(\.wrap\) \{[^}]*flex:\s*1/s);
    expect(branch).toMatch(/\.stage > :global\(\.wrap\) \{[^}]*height:\s*auto/s);
  });
});

describe('a rail that scrolls says so', () => {
  it('fades its inline end, so the keys past the edge are not a secret', () => {
    // On 390px the left rail carries ten keys and shows six. The tenth is
    // «Опубликовать» — the only way out of the editor into the product — and
    // the rail gave no sign it went further. A clipped key is a signal for
    // someone who already knows the rail moves; the edge has to say it first.
    expect(phone).toMatch(/mask-image:\s*linear-gradient\(to right/);
  });
});

describe('a short screen keeps room to draw as well', () => {
  // The floor above is inside `@media (max-width: 40rem)`. Turn the same phone
  // on its side — 844×390 — and the branch does not match: the studio is wide
  // now, and short instead. `panelFloor` keeps the bottom bar off the canvas's
  // throat (151px, more with a soundtrack or a third row), so nothing collapses
  // to nothing the way portrait did; but `max-height: 75vh` lets the bar be
  // dragged to 292 of those 390 and leaves the canvas under a hundred pixels,
  // with no floor of its own to stop at. Width is not the only way a screen
  // runs out.
  const short = [...editorUi.matchAll(/@media \(max-height: ([\d.]+)rem\)/g)].map((m) =>
    block(m.index!),
  );

  it('has a branch that answers the height of the screen', () => {
    expect(short.length).toBeGreaterThan(0);
  });

  it('gives the stage a floor the row cannot go under', () => {
    // Portrait stacks the studio with flex, where `min-height` on the child is
    // the floor. Landscape keeps the grid, where it is not: a `1fr` row hands
    // its item whatever is left, and `min-height` on the item overflows the row
    // rather than growing it. The floor for a grid row is written on the row.
    expect(short.join('\n')).toMatch(/grid-template-rows:\s*minmax\(\s*\d+dvh/);
  });

  it('lowers the bar ceiling so the floor is reachable', () => {
    expect(short.join('\n')).toMatch(/\.studio \.panel \{[^}]*max-height:\s*\d+dvh/);
  });
});

describe('height in the studio is written in dvh', () => {
  // `phone-layout` already requires `dvh` for the rails, the panel and the
  // stage: `vh` is the tall viewport, so a value written in it jumps the moment
  // Mobile Safari collapses its address bar. Three heights were still in `vh`
  // — two of them in the same media block as their `dvh` neighbours, one of
  // them the ceiling a landscape phone actually uses.
  it('no rule measures a height in vh', () => {
    // A rule this file explains is not a rule this file breaks.
    const style = editorUi
      .slice(editorUi.indexOf('<style>'))
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const stray = [...style.matchAll(/[\w-]+:\s*[^;]*?\b[\d.]+vh\b[^;]*/g)].map((m) => m[0].trim());
    expect(stray).toEqual([]);
  });
});
