import { describe, expect, it } from 'bun:test';

const read = (name: string) => Bun.file(new URL(name, import.meta.url).pathname).text();
const shell = await read('./Editor.svelte');
const timeline = await read('./Timeline.svelte');
const rows = await read('./LayerRows.svelte');

// Critique 2026-10-07: on a phone one layer's column held 54 % of the strip —
// five frames of eight in sight. Two causes. The phone's own rules hang on
// `.studio.phone`, and the class went with the tabs (7c42653): the studio wore
// only `compact`, so none of them applied. And a single layer has nothing to
// be moved past and cannot be deleted, yet its handle and its bin held 60 px.
describe('one layer on a phone leaves the strip to the frames', () => {
  it('the phone step wears the class its rules are written for', () => {
    expect(shell).toContain('class:phone={compact}');
  });

  it('a single layer drops the handle and the bin, and the column takes its content', () => {
    expect(timeline).toContain('class:single={editor.doc.layers.length === 1}');
    expect(timeline).toMatch(/:global\(:where\(\.studio\.phone\)\) \.layer-col\.single \{\s*min-width: 0;\s*width: max-content;/);
    expect(rows).toMatch(/:global\(:where\(\.studio\.phone \.layer-col\.single\)\) \.handle,\s*:global\(:where\(\.studio\.phone \.layer-col\.single\)\) \.kill \{\s*display: none;/);
  });
});

// The same critique, a phone lying down: the page was 850 px wide in an 844 px
// window. The folded bar's empty rows still lay in its clip margin.
it('a bar that is its tab alone holds no rows', () => {
  expect(shell).toMatch(/\.studio \.panel\.bare \.toolbar \{\s*display: none;/);
});

// «⋯» on a phone: the page's h1, then the groups — an h3 with no h2 over it.
it('the groups of «⋯» are the next heading level after the page', () => {
  expect(shell).toContain('<h2 class="more-title">');
  expect(shell).not.toContain('<h3 class="more-title">');
});

// …and five pixels tall beyond it: the tab's 24 px press band hung under the
// window's edge.
it('a folded bar\'s tab is pressed upwards of the edge, not past it', () => {
  expect(shell).toMatch(/\.panel\.collapsed \.fold\.lying::after,\s*\.panel\.bare \.fold\.lying::after \{\s*top: auto;\s*bottom: 0;/);
});
