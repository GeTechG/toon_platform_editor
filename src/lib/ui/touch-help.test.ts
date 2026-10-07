import { expect, it } from 'bun:test';
import ru from '../i18n/ru.json';

// Critique 2026-10-06: «Справка» was a table of 33 keys on a phone too, and
// the gestures a finger has — two fingers on the sheet, a hold on the sheet,
// on a frame, on a layer — were written nowhere.
const studio = await Bun.file(new URL('./Editor.svelte', import.meta.url).pathname).text();

it('the manual names the four gestures a finger has', () => {
  expect(Object.keys(ru.gesture).sort()).toEqual(['hold_frame', 'hold_layer', 'hold_sheet', 'two_fingers']);
});

it('under a finger the gestures come before the keys', () => {
  expect(studio).toMatch(/\{@render \(touchFirst \? gestureList : keyList\)\(\)\}\s*\{#if !fingersOnly\}\{@render \(touchFirst \? keyList : gestureList\)\(\)\}\{\/if\}/);
});

// The hover no longer covers any key's glyph — the playing one included: the
// name is on a plate by the key (key-names.test.ts).
