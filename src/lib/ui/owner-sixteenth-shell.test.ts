import { describe, expect, it } from 'bun:test';
import { withoutLetterKeys } from './key-owner';

// Owner's call after the sixteenth audit: the shortcut sheet names the Ctrl
// chord beside the bare letter for undo, copy, paste and merge, so with
// single-letter keys off the keyboard way to them is still listed.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const table = editorUi.slice(editorUi.indexOf('const SHORTCUTS'), editorUi.indexOf('// Copy/paste confirmation'));

describe('the shortcut sheet with single-letter keys off', () => {
  it('keeps the chord of each of the four', () => {
    expect(withoutLetterKeys('Z, Ctrl + Z')).toBe('Ctrl + Z');
    expect(withoutLetterKeys('M, Ctrl + M')).toBe('Ctrl + M');
  });

  it('the rows spell both keys', () => {
    for (const letter of ['Z', 'C', 'V', 'M']) {
      expect(table).toContain(`['${letter}, Ctrl + ${letter}'`);
      expect(table).not.toContain(`['${letter}', `);
    }
  });
});
