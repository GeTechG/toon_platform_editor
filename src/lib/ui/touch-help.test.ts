import { expect, it } from 'bun:test';
import ru from '../i18n/ru.json';

// Critique 2026-10-06: «Справка» was a table of 33 keys on a phone too, and
// the gestures a finger has — two fingers on the sheet, a hold on the sheet,
// on a frame, on a layer — were written nowhere.
const studio = await Bun.file(new URL('./Editor.svelte', import.meta.url).pathname).text();

it('the manual names the gestures a finger has — and the repeat press on a tool (critique 2026-10-13)', () => {
  expect(Object.keys(ru.gesture).sort()).toEqual(['hold_frame', 'hold_layer', 'hold_sheet', 'tool_again', 'two_fingers']);
});

it('under a finger the gestures come before the keys', () => {
  expect(studio).toMatch(/\{#if touchFirst\}\s*\{@render gestureList\(\)\}\s*\{#if !fingersOnly\}\{@render keyList\(\)\}\{\/if\}/);
});

it('under a cursor the mouse follows the keys, not a finger (critique 2026-10-18)', () => {
  expect(studio).toMatch(/\{:else\}\s*\{@render keyList\(\)\}\s*\{@render mouseList\(\)\}/);
});

// The hover no longer covers any key's glyph — the playing one included: the
// name is on a plate by the key (key-names.test.ts).
