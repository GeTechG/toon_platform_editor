import { expect, it } from 'bun:test';
import { manualSections, type ManualContext } from './manual-sections';
import ru from '../i18n/ru.json';

// Critique 2026-10-06: «Справка» was a table of 33 keys on a phone too, and
// the gestures a finger has — two fingers on the sheet, a hold on the sheet,
// on a frame, on a layer — were written nowhere.
const sheet = await Bun.file(new URL('./ManualSheet.svelte', import.meta.url).pathname).text();
const context = (input: ManualContext['input']): ManualContext => ({
  input,
  tools: [{ id: 'pencil', label: 'Кисть' }, { id: 'drag', label: 'Рука' }],
  quickPalette: false,
  hasProjectFile: false,
  fullscreen: true,
  toolOpensBrush: true,
  keysOf: () => [],
});
const kindsIn = (input: ManualContext['input'], section: string) =>
  manualSections(context(input)).find((one) => one.id === section)!.rows.map((row) => row.kind);

it('the manual names the gestures a finger has — and the repeat press on a tool (critique 2026-10-13)', () => {
  expect(Object.keys(ru.gesture).sort()).toEqual(['hold_frame', 'hold_layer', 'hold_sheet', 'tool_again', 'two_fingers']);
});

it('under a finger the gestures come before the keys', () => {
  expect(sheet).toContain("matchMedia('(any-hover: none)').matches ? 'finger' : matchMedia('(hover: none)').matches ? 'both' : 'cursor'");
  const kinds = kindsIn('both', 'sheet');
  expect(kinds.lastIndexOf('gesture')).toBeLessThan(kinds.indexOf('command'));
  expect(kinds).not.toContain('mouse');
});

it('under a cursor the mouse follows the keys, not a finger (critique 2026-10-18)', () => {
  const kinds = kindsIn('cursor', 'sheet');
  expect(kinds.lastIndexOf('command')).toBeLessThan(kinds.indexOf('mouse'));
  expect(kinds).not.toContain('gesture');
});

// The hover no longer covers any key's glyph — the playing one included: the
// name is on a plate by the key (key-names.test.ts).
