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

const hub = await Bun.file(new URL('./DraftsHub.svelte', import.meta.url).pathname).text();

it('«Новый мульт» takes the standing sheet for an untouched drawing', () => {
  expect(hub).toMatch(/isEmptyDocument\(editor\.doc\)[^]{0,200}standsByDefault\(/);
});
