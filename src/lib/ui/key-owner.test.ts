import { describe, expect, it } from 'bun:test';
import { keyOwner, latinKey, type KeyPress } from './key-owner';

// The editor listens on the window, so every key a focused control was meant
// to get reached the hotkey table first. Space played the preview from a
// checkbox and ate the space in the track name; an arrow that resized a panel
// also walked the frame. A key belongs to the editor only when nothing on the
// way to the window claimed it.

/** A focused element, as much of it as the rule reads. */
function el(tag: string, attrs: Record<string, string> = {}, keyboardFocus = true) {
  return {
    tagName: tag.toUpperCase(),
    isContentEditable: attrs.contenteditable === 'true',
    getAttribute: (name: string) => attrs[name] ?? null,
    matches: (selector: string) => selector === ':focus-visible' && keyboardFocus,
  };
}

function press(key: string, target: ReturnType<typeof el> | null, extra: Partial<KeyPress> = {}): KeyPress {
  return { key, target, defaultPrevented: false, ctrlKey: false, metaKey: false, modalOpen: false, letterKeys: true, ...extra };
}

describe('a key a control handled stays with it', () => {
  it('an arrow the resizer already took does not also move the frame', () => {
    expect(keyOwner(press('ArrowUp', el('div', { role: 'separator' }), { defaultPrevented: true }))).toBe('control');
  });
});

describe('a text field keeps what it types', () => {
  it('Space types a space in the track name instead of playing', () => {
    expect(keyOwner(press(' ', el('input', { type: 'text' })))).toBe('control');
  });

  it('letters stay in the field', () => {
    expect(keyOwner(press('b', el('textarea')))).toBe('control');
  });

  it('Enter and Escape still apply and cancel from a transform field', () => {
    expect(keyOwner(press('Enter', el('input', { type: 'number' })))).toBe('editor');
    expect(keyOwner(press('Escape', el('input', { type: 'number' })))).toBe('editor');
  });

  it('an editable region counts as a field', () => {
    expect(keyOwner(press(' ', el('div', { contenteditable: 'true' })))).toBe('control');
  });
});

describe('a control reached by keyboard is pressed by Space and Enter', () => {
  it('Space toggles the checkbox it is on', () => {
    expect(keyOwner(press(' ', el('input', { type: 'checkbox' })))).toBe('control');
  });

  it('Space and Enter press a button', () => {
    expect(keyOwner(press(' ', el('button')))).toBe('control');
    expect(keyOwner(press('Enter', el('button')))).toBe('control');
  });

  it('a role that promises a press behaves like the element', () => {
    expect(keyOwner(press(' ', el('div', { role: 'option' })))).toBe('control');
    expect(keyOwner(press('Enter', el('a', { href: '/a/1' })))).toBe('control');
  });

  it('a slider keeps its arrows', () => {
    expect(keyOwner(press('ArrowLeft', el('div', { role: 'slider' })))).toBe('control');
    expect(keyOwner(press('ArrowLeft', el('input', { type: 'range' })))).toBe('control');
  });

  it('hotkeys still work from a focused button', () => {
    expect(keyOwner(press('b', el('button')))).toBe('editor');
    expect(keyOwner(press('ArrowRight', el('button')))).toBe('editor');
  });

  it('a button the mouse left focused hands Space back to the preview', () => {
    // Clicking a tool leaves focus on it; the next Space is meant for the
    // reference's play/stop, not for pressing that tool a second time.
    expect(keyOwner(press(' ', el('button', {}, false)))).toBe('editor');
  });
});

describe('a modal sheet takes the keyboard', () => {
  it('no hotkey fires behind an open sheet', () => {
    expect(keyOwner(press('b', null, { modalOpen: true }))).toBe('control');
    expect(keyOwner(press(' ', null, { modalOpen: true }))).toBe('control');
  });
});

describe('single-letter keys can be turned off (WCAG 2.1.4)', () => {
  it('with the setting off a bare letter, digit or sign does nothing', () => {
    expect(keyOwner(press('b', null, { letterKeys: false }))).toBe('control');
    expect(keyOwner(press('+', null, { letterKeys: false }))).toBe('control');
  });

  it('keys that are not a character still work', () => {
    for (const key of [' ', 'ArrowLeft', 'Delete', 'F7', 'Escape', 'Enter']) {
      expect(keyOwner(press(key, null, { letterKeys: false }))).toBe('editor');
    }
  });

  it('a letter with Ctrl is a chord, not a single key', () => {
    expect(keyOwner(press('z', null, { letterKeys: false, ctrlKey: true }))).toBe('editor');
  });

  it('with the setting on, the page body hands everything to the editor', () => {
    expect(keyOwner(press('b', el('body')))).toBe('editor');
  });
});

describe('the hotkeys do not depend on the keyboard layout', () => {
  // Most of the audience types on a Russian layout: B there is «и», Ctrl+S is
  // Ctrl+«ы» — which the table missed and the browser took for «save page».
  it('a Cyrillic letter reads as the Latin key in the same place', () => {
    expect(latinKey({ key: 'и', code: 'KeyB' })).toBe('b');
    expect(latinKey({ key: 'У', code: 'KeyE' })).toBe('E');
    expect(latinKey({ key: 'ы', code: 'KeyS' })).toBe('s');
    expect(latinKey({ key: 'ё', code: 'Backquote' })).toBe('`');
    expect(latinKey({ key: 'Ё', code: 'Backquote' })).toBe('~');
  });

  it('a Latin letter, a sign and a named key stay as they are', () => {
    expect(latinKey({ key: 'b', code: 'KeyB' })).toBe('b');
    expect(latinKey({ key: 'H', code: 'KeyH' })).toBe('H');
    expect(latinKey({ key: '+', code: 'Equal' })).toBe('+');
    expect(latinKey({ key: 'ArrowLeft', code: 'ArrowLeft' })).toBe('ArrowLeft');
    expect(latinKey({ key: ' ', code: 'Space' })).toBe(' ');
    // A layout that moves the letters about (AZERTY, Dvorak) still types
    // Latin: its own letter wins over the physical place.
    expect(latinKey({ key: 'a', code: 'KeyQ' })).toBe('a');
  });

  it('the editor reads its table through it', async () => {
    const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
    const handler = editorUi.match(/function onKeydown\([^]*?\n  }\n/)![0];
    expect(handler).toContain('latinKey(e)');
    expect(handler).not.toMatch(/switch \(e\.key\)/);
    expect(handler).not.toContain('toolByKey(e.key)');
  });
});

describe('ninth audit: Space on a timeline cell plays', () => {
  // Arrowing through the strip leaves focus on the active cell, and Space
  // there pressed that cell: it collapsed the Shift+arrow range the preview
  // was about to play instead of playing it. A cell is already selected by
  // being active — Space is the preview's, Enter still presses the cell.
  it('Space from a keyboard-focused cell is the preview', () => {
    expect(keyOwner(press(' ', el('button', { 'data-frame': '3' })))).toBe('editor');
  });

  it('Enter still presses the cell', () => {
    expect(keyOwner(press('Enter', el('button', { 'data-frame': '3' })))).toBe('control');
  });
});
