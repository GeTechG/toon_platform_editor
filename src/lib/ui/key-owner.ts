/**
 * Who a keystroke that reached the window belongs to: the editor's hotkey
 * table, or the control it was pressed on. The editor listens on the window,
 * so without this every key a focused control was meant to get — Space on a
 * checkbox, a space in a text field, an arrow on a resizer — ran a hotkey too.
 */

/** The part of the focused element the rule reads. */
export interface KeyTarget {
  tagName: string;
  isContentEditable: boolean;
  getAttribute(name: string): string | null;
  matches(selector: string): boolean;
}

export interface KeyPress {
  key: string;
  target: KeyTarget | null;
  /** Something on the way to the window already acted on the key. */
  defaultPrevented: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  /** A modal sheet is up: the page behind it is inert, its hotkeys too. */
  modalOpen: boolean;
  /** The «single-letter keys» setting (WCAG 2.1.4). */
  letterKeys: boolean;
}

/** Input types that are typed into rather than pressed. */
const TEXT_TYPES = new Set(['text', 'search', 'email', 'password', 'url', 'tel', 'number', '']);
/** Roles and elements that Space and Enter press. */
const PRESSED = new Set(['button', 'switch', 'checkbox', 'radio', 'option', 'tab', 'menuitem', 'link']);
/** Roles and inputs that keep their arrows. */
const SLIDERS = new Set(['slider', 'separator', 'spinbutton', 'range']);
const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/** A field still hands these over: apply and cancel a transform from its inputs. */
const FIELD_PASSES = new Set(['Enter', 'Escape']);

function kindOf(target: KeyTarget): { field: boolean; pressed: boolean; slider: boolean } {
  const tag = target.tagName.toLowerCase();
  const role = target.getAttribute('role');
  if (target.isContentEditable || tag === 'textarea' || tag === 'select') {
    return { field: true, pressed: false, slider: false };
  }
  if (tag === 'input') {
    const type = (target.getAttribute('type') ?? '').toLowerCase();
    if (TEXT_TYPES.has(type) && role === null) {
      return { field: true, pressed: false, slider: false };
    }
    return { field: false, pressed: type !== 'range', slider: type === 'range' };
  }
  const link = tag === 'a' && target.getAttribute('href') !== null;
  return {
    field: false,
    pressed: tag === 'button' || tag === 'summary' || link || (role !== null && PRESSED.has(role)),
    slider: role !== null && SLIDERS.has(role),
  };
}

export function keyOwner(e: KeyPress): 'editor' | 'control' {
  if (e.defaultPrevented || e.modalOpen) {
    return 'control';
  }
  const chord = e.ctrlKey || e.metaKey;
  if (!e.letterKeys && !chord && e.key.length === 1 && e.key !== ' ') {
    return 'control';
  }
  if (!e.target) {
    return 'editor';
  }
  const kind = kindOf(e.target);
  if (kind.field) {
    return FIELD_PASSES.has(e.key) ? 'editor' : 'control';
  }
  if (kind.slider && ARROWS.has(e.key)) {
    return 'control';
  }
  // Only a control reached by keyboard is pressed from it: the mouse leaves a
  // clicked tool focused, and the next Space is the preview's.
  // A timeline cell is selected by being active, so Space there is the
  // preview's too — pressing it collapsed the range about to be played.
  const cell = e.key === ' ' && e.target.getAttribute('data-frame') !== null;
  if (kind.pressed && !cell && (e.key === ' ' || e.key === 'Enter') && e.target.matches(':focus-visible')) {
    return 'control';
  }
  return 'editor';
}

/**
 * The key as the table spells it, whatever the layout. The table is written in
 * Latin letters, and on a Russian layout B arrives as «и» and Ctrl+S as
 * Ctrl+«ы» — none of the letter keys worked, and the browser took Ctrl+S for
 * «save page». A letter outside Latin is read by where it sits instead; a
 * layout that types Latin (AZERTY, Dvorak) keeps its own letters.
 */
export function latinKey(e: { key: string; code: string }): string {
  if (e.key.length !== 1 || /[\x00-\x7f]/.test(e.key)) {
    return e.key;
  }
  const upper = e.key !== e.key.toLowerCase();
  const letter = /^Key([A-Z])$/.exec(e.code)?.[1];
  if (letter) {
    return upper ? letter : letter.toLowerCase();
  }
  if (e.code === 'Backquote') {
    return upper ? '~' : '`';
  }
  return e.key;
}

/**
 * Keys that mean «more of the same» and run on while held: steps, brush size,
 * zoom, undo and redo, turning a selection, new frames, deleting. Everything
 * else is one press per press — a held K flipped the onion skin with every
 * auto-repeat and stopped wherever the hand let go, a held Space started and
 * stopped the preview.
 */
const HELD = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  '+', '=', '-', '_',
  'z', 'Z', 'y', 'Y',
  'q', 'Q', 'w', 'W',
  'a', 'A', 'F7', 'Delete',
]);

export function repeats(key: string): boolean {
  return HELD.has(key);
}
