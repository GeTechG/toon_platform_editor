import { describe, expect, it } from 'bun:test';
import { withoutLetterKeys } from './key-owner';
import { buildKeymap, chordLabel, studioCommands } from './keymap';

// Owner's call after the sixteenth audit: the shortcut sheet names the Ctrl
// chord beside the bare letter for undo, copy, paste and merge, so with
// single-letter keys off the keyboard way to them is still listed.
const keys = buildKeymap(studioCommands([]), {});

describe('the shortcut sheet with single-letter keys off', () => {
  it('keeps the chord of each of the four', () => {
    expect(withoutLetterKeys('Z, Ctrl + Z')).toBe('Ctrl + Z');
    expect(withoutLetterKeys('M, Ctrl + M')).toBe('Ctrl + M');
  });

  it('the rows spell both keys', () => {
    for (const [command, letter] of [['undo', 'Z'], ['copy', 'C'], ['paste', 'V'], ['merge', 'M']]) {
      expect(keys.bindings(command).map(chordLabel)).toEqual([letter, `Ctrl+${letter}`]);
    }
  });
});
