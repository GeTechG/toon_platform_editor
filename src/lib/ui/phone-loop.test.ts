import { expect, it } from 'bun:test';
import { standsByDefault } from './sheet-size';

// Critique 2026-10-06: on a 390×844 phone the default 16:9 sheet lying down
// was 246×138 px of an 844-tall screen. A phone held upright is offered a
// sheet that stands; a cursor, or a phone lying down, keeps the lying one.
it('a new sheet stands on a touch screen held upright', () => {
  expect(standsByDefault({ w: 390, h: 844 }, true)).toBe(true);
  expect(standsByDefault({ w: 844, h: 390 }, true)).toBe(false);
  expect(standsByDefault({ w: 900, h: 1200 }, false)).toBe(false);
});

const studio = await Bun.file(new URL('./Editor.svelte', import.meta.url).pathname).text();
const hub = await Bun.file(new URL('./DraftsHub.svelte', import.meta.url).pathname).text();

it('«Новый мульт» takes the standing sheet for an untouched drawing', () => {
  expect(hub).toMatch(/isEmptyDocument\(editor\.doc\)[^]{0,200}standsByDefault\(/);
});

// «Добавить кадр» was behind the «Таймлайн» tab: the resting phone screen had
// a transport and no way to a second frame.
it('the mini transport adds a frame', () => {
  const dock = studio.slice(studio.indexOf('<div class="mini-transport"'), studio.indexOf('<div class="tabs"'));
  expect(dock).toMatch(/onclick=\{onAddFrame\}[^]*?aria-label=\{t\('editor\.add_frame'\)\}/);
});

// Eight bare icons in «Ещё», the export among them: under a finger there is
// no title to read. Each key says its name beside its icon.
it('the keys of «Ещё» wear their names', () => {
  expect(studio).toContain("class:more={shownTab.id === 'more'}");
  expect(studio).toMatch(/\.tab-window\.more > :global\(\.key\[aria-label\]\)::before \{[^}]*content: attr\(aria-label\)/);
});
