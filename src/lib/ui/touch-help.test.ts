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
  expect(studio).toMatch(/\{@render \(touchFirst \? gestureList : keyList\)\(\)\}\s*\{@render \(touchFirst \? keyList : gestureList\)\(\)\}/);
});

// The cursor rests on Play after the press, and the hover put «Space» over
// the key: nothing on screen said «stop».
it('the playing key keeps its stop glyph under the cursor', () => {
  expect(studio).toMatch(/\.key\.play\.playing\[data-key\]:hover:not\(:disabled\)\)::after \{\s*content: none;/);
});
