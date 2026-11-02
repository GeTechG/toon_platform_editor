import { describe, expect, it } from 'bun:test';
import { assignChord, buildKeymap, chordAria, chordLabel, chordOf, holdersOf, isBare, normalizeChord, readOverrides, refusal, removeChord, resetCommand, rewriteHint, studioCommands, type Command } from './keymap';

const press = (key: string, code = '', mods: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean } = {}) => ({
  key,
  code,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
});

const TABLE: Command[] = [
  { id: 'undo', defaults: ['z', 'Ctrl+z'] },
  { id: 'redo', defaults: ['y', 'Ctrl+y', 'Ctrl+Shift+z'] },
  { id: 'add-frame', defaults: ['a'] },
  { id: 'add-layer', defaults: ['Shift+a'] },
];

describe('a press names a chord, whatever the layout', () => {
  it('a Russian layout reads by place', () => {
    expect(chordOf(press('я', 'KeyZ'))).toBe('z');
    expect(chordOf(press('б', 'Comma'))).toBe(',');
  });

  it('Cmd is Ctrl, and Caps Lock changes nothing', () => {
    expect(chordOf(press('z', 'KeyZ', { meta: true }))).toBe('Ctrl+z');
    expect(chordOf(press('Z', 'KeyZ'))).toBe('z');
  });

  it('a sign carries its Shift in itself: the key is one whichever way it was typed', () => {
    expect(chordOf(press('+', 'Equal', { shift: true }))).toBe('+');
    expect(chordOf(press('=', 'Equal'))).toBe('+');
    expect(chordOf(press('_', 'Minus', { shift: true }))).toBe('-');
    expect(chordOf(press('`', 'Backquote'))).toBe('~');
  });

  it('a modifier alone is no chord yet', () => {
    expect(chordOf(press('Shift', 'ShiftLeft', { shift: true }))).toBeNull();
    expect(chordOf(press('Control', 'ControlLeft', { ctrl: true }))).toBeNull();
  });

  it('named keys keep their Shift', () => {
    expect(chordOf(press('ArrowLeft', 'ArrowLeft', { shift: true }))).toBe('Shift+ArrowLeft');
    expect(chordOf(press(' ', 'Space', { shift: true }))).toBe('Shift+Space');
  });
});

describe('a chord names a command', () => {
  const map = buildKeymap(TABLE, {});

  it('finds the command by its key', () => {
    expect(map.resolve('z')).toBe('undo');
    expect(map.resolve('Ctrl+Shift+z')).toBe('redo');
  });

  it('Shift with no meaning of its own is the same key', () => {
    expect(map.resolve('Shift+z')).toBe('undo');
    expect(map.resolve('Shift+a')).toBe('add-layer');
  });

  it('nothing else holds a Ctrl chord, so the browser keeps it', () => {
    expect(map.resolve('Ctrl+p')).toBeNull();
  });
});

describe('what the person changed', () => {
  it('a key given to a command works, and the one it replaced stops', () => {
    const map = buildKeymap(TABLE, { undo: ['u', 'Ctrl+z'] });
    expect(map.resolve('u')).toBe('undo');
    expect(map.resolve('z')).toBeNull();
    expect(map.bindings('undo')).toEqual(['u', 'Ctrl+z']);
    expect(map.changed('undo')).toBe(true);
    expect(map.changed('redo')).toBe(false);
  });

  it('a change over a default wins the key, and the row that lost it stops naming it', () => {
    const map = buildKeymap(TABLE, { undo: ['a'] });
    expect(map.resolve('a')).toBe('undo');
    expect(map.bindings('add-frame')).toEqual([]);
  });

  it('asks who holds a key before taking it, leaving out the asker', () => {
    expect(holdersOf(TABLE, {}, 'a', 'undo')).toEqual(['add-frame']);
    expect(holdersOf(TABLE, {}, 'z', 'undo')).toEqual([]);
    expect(holdersOf(TABLE, {}, 'u', 'undo')).toEqual([]);
  });

  it('giving a held key away takes it from the holder and leaves its other keys', () => {
    const taken = assignChord(TABLE, {}, 'add-frame', 'Ctrl+z', 'a');
    const map = buildKeymap(TABLE, taken);
    expect(map.resolve('Ctrl+z')).toBe('add-frame');
    expect(map.bindings('undo')).toEqual(['z']);
    expect(map.bindings('add-frame')).toEqual(['Ctrl+z']);
  });

  it('with nothing to replace the key is added to the command', () => {
    const map = buildKeymap(TABLE, assignChord(TABLE, {}, 'undo', 'u'));
    expect(map.bindings('undo')).toEqual(['z', 'Ctrl+z', 'u']);
  });

  it('a key put back to where it was leaves no change behind', () => {
    const away = assignChord(TABLE, {}, 'undo', 'u', 'z');
    expect(assignChord(TABLE, away, 'undo', 'z', 'u')).toEqual({});
  });

  it('a key can be removed, and a command may be left with none', () => {
    const none = removeChord(TABLE, removeChord(TABLE, {}, 'undo', 'z'), 'undo', 'Ctrl+z');
    const map = buildKeymap(TABLE, none);
    expect(map.bindings('undo')).toEqual([]);
    expect(map.resolve('z')).toBeNull();
    expect(map.changed('undo')).toBe(true);
  });

  it('a row put back gets its keys again, unless someone took them since', () => {
    const taken = assignChord(TABLE, {}, 'add-frame', 'z');
    const back = resetCommand(taken, 'undo');
    const map = buildKeymap(TABLE, back);
    expect(map.bindings('undo')).toEqual(['Ctrl+z']);
    expect(map.resolve('z')).toBe('add-frame');
  });
});

describe('keys a person cannot be given', () => {
  it('the ones the studio or the page needs fixed', () => {
    for (const chord of ['Tab', 'Shift+Tab', 'Enter', 'Shift+Enter', 'Escape']) {
      expect(refusal(chord)).toBe('fixed');
    }
  });

  it('the ones the browser keeps for itself', () => {
    for (const chord of ['Ctrl+t', 'Ctrl+w', 'Ctrl+n', 'Ctrl+Shift+t', 'Ctrl+r', 'F5', 'F11', 'F12', 'Alt+ArrowLeft', 'Alt+F4', 'Ctrl+Alt+e']) {
      expect(refusal(chord)).toBe('browser');
    }
  });

  it('anything else is free', () => {
    for (const chord of ['b', 'Space', 'F2', 'Ctrl+k', 'Alt+e', '5', 'Shift+ArrowLeft']) {
      expect(refusal(chord)).toBeNull();
    }
  });
});

describe('what comes back from storage', () => {
  it('keeps valid lists, whatever command they name: a plugin may load later', () => {
    expect(readOverrides({ undo: ['u'], 'tool:later': ['Ctrl+k'], redo: [] })).toEqual({ undo: ['u'], 'tool:later': ['Ctrl+k'], redo: [] });
  });

  it('drops what is not a list of keys, and keys that may not be given', () => {
    expect(readOverrides({ undo: 'u', redo: [1, 'y', 'Tab', 'Ctrl+t'], copy: null })).toEqual({ redo: ['y'] });
    expect(readOverrides('junk')).toEqual({});
    expect(readOverrides(undefined)).toEqual({});
  });
});

describe('a chord for people and for a screen reader', () => {
  it('writes keys as they are on the caps', () => {
    expect(chordLabel('Ctrl+Shift+z')).toBe('Ctrl+Shift+Z');
    expect(chordLabel('ArrowLeft')).toBe('←');
    expect(chordLabel('Delete')).toBe('Del');
    expect(chordLabel('Space')).toBe('Space');
  });

  it('writes aria-keyshortcuts as the ARIA grammar has it', () => {
    expect(chordAria('Ctrl+Shift+z')).toBe('Control+Shift+Z');
    expect(chordAria('Alt+e')).toBe('Alt+E');
    expect(chordAria('Space')).toBe('Space');
  });

  it('reads a plugin manifest key into the table spelling', () => {
    expect(normalizeChord('Alt+E')).toBe('Alt+e');
    expect(normalizeChord('B')).toBe('b');
    expect(normalizeChord('=')).toBe('+');
    expect(normalizeChord('')).toBeNull();
  });
});

describe('the same key in two places', () => {
  const scoped: Command[] = [
    { id: 'lasso', defaults: ['q'] },
    { id: 'turn-left', defaults: ['q'], scope: 'transform' },
    { id: 'feather', defaults: ['f'] },
    { id: 'fullscreen', defaults: ['f'] },
  ];

  it('a transform-only command answers only in a transform', () => {
    const map = buildKeymap(scoped, {});
    expect(map.resolve('q')).toBe('lasso');
    expect(map.resolve('q', { transform: true })).toBe('turn-left');
  });

  it('they do not count as a clash: the two never compete', () => {
    expect(holdersOf(scoped, {}, 'q', 'turn-left')).toEqual([]);
    expect(holdersOf(scoped, {}, 'q', 'feather')).toEqual(['lasso']);
  });

  it('a command that is not here now leaves the key to the next', () => {
    const map = buildKeymap(scoped, {});
    expect(map.resolve('f', { available: (id) => id !== 'feather' })).toBe('fullscreen');
    expect(map.resolve('f', { available: () => true })).toBe('feather');
  });
});

describe('the studio out of the box: every key the reference and we promised', () => {
  const tools = [
    { id: 'pencil', keys: ['B'] },
    { id: 'mega-eraser', keys: ['Alt+E'] },
    { id: 'feather', keys: ['F'] },
    { id: 'drag', keys: ['D', 'O'] },
    { id: 'lasso', keys: ['Q', 'S'] },
    { id: 'no-key', keys: [] },
  ];
  const commands = studioCommands(tools);
  const map = buildKeymap(commands, {});
  const cases: [string, string][] = [
    ['b', 'tool:pencil'], ['Shift+b', 'tool:pencil'], ['Alt+e', 'tool:mega-eraser'],
    ['d', 'tool:drag'], ['o', 'tool:drag'], ['q', 'tool:lasso'], ['s', 'tool:lasso'],
    ['z', 'undo'], ['Shift+z', 'undo'], ['Ctrl+z', 'undo'], ['Ctrl+Shift+z', 'redo'], ['y', 'redo'], ['Ctrl+y', 'redo'],
    ['c', 'copy'], ['Ctrl+c', 'copy'], ['v', 'paste'], ['Ctrl+v', 'paste'], ['Ctrl+x', 'cut'], ['x', 'swap'],
    ['m', 'merge'], ['Ctrl+m', 'merge'],
    ['a', 'add-frame'], ['F7', 'add-frame'], ['Ctrl+a', 'add-frame-before'], ['Ctrl+F7', 'add-frame-before'],
    ['Shift+a', 'add-layer'], ['Shift+F7', 'add-layer'], ['Ctrl+Shift+a', 'add-layer-before'], ['Ctrl+Shift+F7', 'add-layer-before'],
    ['g', 'duplicate-frame'], ['Delete', 'delete-frame'], ['Backspace', 'delete-frame'],
    ['Shift+Delete', 'delete-layer'], ['Shift+Backspace', 'delete-layer'],
    ['j', 'frame-first'], ['l', 'frame-last'],
    ['ArrowLeft', 'frame-prev'], ['ArrowRight', 'frame-next'], ['ArrowUp', 'layer-up'], ['ArrowDown', 'layer-down'],
    ['Shift+ArrowLeft', 'extend-left'], ['Shift+ArrowDown', 'extend-down'],
    ['h', 'mirror-h'], ['Shift+h', 'mirror-v'], ['k', 'onion'],
    ['Space', 'play'], ['Shift+Space', 'play-from-active'],
    ['+', 'brush-bigger'], ['-', 'brush-smaller'], ['Ctrl++', 'zoom-in'], ['Ctrl+-', 'zoom-out'],
    ['Ctrl+Shift+ArrowLeft', 'pan-left'], ['Ctrl+Shift+ArrowUp', 'pan-up'], ['[', 'turn-left'], [']', 'turn-right'],
    ['Ctrl+s', 'save'], ['Alt+s', 'export'], ['Alt+l', 'error-log'], ['p', 'tool:pipette'],
  ];

  for (const [chord, id] of cases) {
    it(`${chord} is ${id}`, () => {
      // The tools the row lists above stand in for the rest; the pipette comes from the list too.
      const full = buildKeymap(studioCommands([...tools, { id: 'pipette', keys: ['P'] }]), {});
      expect(full.resolve(chord)).toBe(id);
    });
  }

  it('F is the pen where the pen is on the panel, fullscreen elsewhere', () => {
    expect(map.resolve('f', { available: () => true })).toBe('tool:feather');
    expect(map.resolve('f', { available: (id) => id !== 'tool:feather' })).toBe('fullscreen');
  });

  it('in a transform Q and W turn, and Q still picks the lasso outside it', () => {
    expect(map.resolve('q', { transform: true })).toBe('transform-turn-left');
    expect(map.resolve('w', { transform: true })).toBe('transform-turn-right');
    expect(map.resolve('w')).toBeNull();
  });

  it('a held key runs on only where more of the same is the point', () => {
    const held = (id: string) => commands.find((command) => command.id === id)?.repeat === true;
    for (const id of ['undo', 'redo', 'frame-next', 'layer-up', 'brush-bigger', 'zoom-in', 'turn-left', 'add-frame', 'delete-frame', 'transform-turn-left']) {
      expect(held(id)).toBe(true);
    }
    for (const id of ['onion', 'play', 'mirror-h', 'tool:pencil', 'save']) {
      expect(held(id)).toBe(false);
    }
  });

  it('a tool with no key of its own is listed, to be given one', () => {
    expect(map.bindings('tool:no-key')).toEqual([]);
  });

  it('the browser keeps what the table does not hold', () => {
    for (const chord of ['Ctrl+p', 'Ctrl+l', 'Ctrl+g', 'Ctrl+f', 'Alt+x']) {
      expect(map.resolve(chord)).toBeNull();
    }
  });
});

describe('a hint on a button follows the keys', () => {
  it('writes the keys in place of the ones it was authored with', () => {
    expect(rewriteHint('Кисть (B)', ['K'])).toBe('Кисть (K)');
    expect(rewriteHint('Рука (D или O) — двигать холст', ['K', 'Ctrl+K'])).toBe('Рука (K / Ctrl+K) — двигать холст');
    expect(rewriteHint('Цвет (M — вся палитра)', ['K'])).toBe('Цвет (K — вся палитра)');
    expect(rewriteHint('Пипетка (P). Ещё одно нажатие', ['K'])).toBe('Пипетка (K). Ещё одно нажатие');
  });

  it('with no key left the brackets go, and what else they said stays', () => {
    expect(rewriteHint('Кисть (B)', [])).toBe('Кисть');
    expect(rewriteHint('Цвет (M — вся палитра)', [])).toBe('Цвет (вся палитра)');
    expect(rewriteHint('Калька (K) включена', [])).toBe('Калька включена');
  });

  it('text with no brackets stays', () => {
    expect(rewriteHint('Кисть', ['K'])).toBe('Кисть');
  });
});

describe('moved: whether the keys differ from the ones hints are written with', () => {
  it('a default that lost its key to a changed row has moved though it was not changed', () => {
    const map = buildKeymap(TABLE, { undo: ['a'] });
    expect(map.moved('add-frame')).toBe(true);
    expect(map.changed('add-frame')).toBe(false);
    expect(map.moved('redo')).toBe(false);
  });
});

describe('a bare key is what the single-letter setting turns off', () => {
  it('reads letters and signs, not chords or named keys', () => {
    for (const chord of ['b', 'Shift+b', '+', '5', '[']) expect(isBare(chord)).toBe(true);
    for (const chord of ['Ctrl+b', 'Alt+e', 'Space', 'F7', 'ArrowLeft', 'Shift+ArrowLeft', 'Delete']) expect(isBare(chord)).toBe(false);
  });
});

describe('the keys that answer now', () => {
  const commands = studioCommands([{ id: 'feather', keys: ['F'] }, { id: 'lasso', keys: ['Q'] }]);

  it('a key another command takes first is not named: the pen on the panel holds F', () => {
    const map = buildKeymap(commands, {});
    expect(map.effective('fullscreen', () => true)).toEqual([]);
    expect(map.effective('fullscreen', (id) => id !== 'tool:feather')).toEqual(['f']);
    expect(map.effective('tool:feather', () => true)).toEqual(['f']);
  });

  it('a command of a mode names its key though another holds it outside the mode', () => {
    const map = buildKeymap(commands, {});
    expect(map.effective('transform-turn-left', () => true)).toEqual(['q']);
    expect(map.effective('tool:lasso', () => true)).toEqual(['q']);
  });

  it('fullscreen given its own key names it with the pen on the panel', () => {
    const map = buildKeymap(commands, { fullscreen: ['Ctrl+k'] });
    expect(map.effective('fullscreen', () => true)).toEqual(['Ctrl+k']);
  });
});

describe('a key shared by design stays in its order', () => {
  const commands = studioCommands([{ id: 'feather', keys: ['F'] }]);

  it('adding a key to fullscreen does not take F from the pen on the panel', () => {
    const next = assignChord(commands, {}, 'fullscreen', 'F2');
    const map = buildKeymap(commands, next);
    expect(map.resolve('f', { available: () => true })).toBe('tool:feather');
    expect(map.effective('tool:feather', () => true)).toEqual(['f']);
    expect(map.effective('fullscreen', () => true)).toEqual(['F2']);
  });

  it('with the pen off the panel F is fullscreen again, F2 still', () => {
    const map = buildKeymap(commands, assignChord(commands, {}, 'fullscreen', 'F2'));
    expect(map.effective('fullscreen', (id) => id !== 'tool:feather')).toEqual(['f', 'F2']);
  });
});
