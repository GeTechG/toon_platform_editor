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

/** The phone branch of the studio stylesheet. */
function phoneBranch(): string {
  const start = editorUi.indexOf('/* Phone: no room for side columns');
  expect(start).toBeGreaterThan(-1);
  const open = editorUi.indexOf('{', editorUi.indexOf('@media (max-width: 40rem)', start));
  let depth = 0;
  for (let i = open; i < editorUi.length; i++) {
    if (editorUi[i] === '{') depth++;
    if (editorUi[i] === '}' && --depth === 0) return editorUi.slice(open, i);
  }
  throw new Error('unterminated phone branch');
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

describe('a rail that scrolls says so', () => {
  it('fades its inline end, so the keys past the edge are not a secret', () => {
    // On 390px the left rail carries ten keys and shows six. The tenth is
    // «Опубликовать» — the only way out of the editor into the product — and
    // the rail gave no sign it went further. A clipped key is a signal for
    // someone who already knows the rail moves; the edge has to say it first.
    expect(phone).toMatch(/mask-image:\s*linear-gradient\(to right/);
  });
});
