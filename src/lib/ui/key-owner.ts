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
  /** Shift held: Ctrl+Shift+arrows move a magnified sheet (panSheetKey). */
  shiftKey?: boolean;
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

/**
 * The chords the table takes: the reference's Ctrl+Z, Y, C, V and M, Ctrl+A
 * / Ctrl+F7 (a frame in front), and Ctrl+X, the cut next to C and V. Every other Ctrl chord went down the table as
 * well and was prevented — Ctrl+= thickened the brush instead of zooming the
 * page (WCAG 1.4.4), Ctrl+P picked the pipette instead of printing, Ctrl+L
 * never reached the address bar. Ctrl+S is the editor's own, before this.
 */
const CHORDS = new Set(['z', 'Z', 'y', 'Y', 'c', 'C', 'v', 'V', 'x', 'X', 'm', 'M', 'a', 'A', 'F7']);

/** The four arrows alone — Home, End and the page keys pan nothing. */
const PAN_ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

/**
 * Ctrl+Shift+arrow (Cmd+Shift on a Mac): the sheet moved from the keyboard
 * (owner, after the fourteenth audit). Not Shift+arrows — those extend the
 * strip's selection and push a transform ten units; not Alt — Alt+← is the
 * browser's «back»; not Ctrl alone — Ctrl+← on a Mac switches desktops.
 * Outside a text field nothing in a browser holds Ctrl+Shift+arrow; inside
 * one it still selects by words (the field check below).
 */
export function panSheetKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey?: boolean }): boolean {
  return (e.ctrlKey || e.metaKey) && e.shiftKey === true && PAN_ARROWS.has(e.key);
}

/**
 * An input method is composing: its Enter picks a character, its Esc drops
 * the composition. Safari sends the Enter that commits it with `isComposing`
 * already false — keyCode 229 is the one mark it keeps.
 */
export function composing(e: { isComposing: boolean; keyCode: number }): boolean {
  return e.isComposing || e.keyCode === 229;
}

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

/**
 * A field text is typed into. Its Alt chords are its own: Option+E is the
 * accent dead key on a Mac, AltGr+E, S and L are ę, ś and ł in Polish.
 */
export function typesText(target: KeyTarget | null): boolean {
  return target !== null && kindOf(target).field;
}

export function keyOwner(e: KeyPress): 'editor' | 'control' {
  if (e.defaultPrevented || e.modalOpen) {
    return 'control';
  }
  const chord = e.ctrlKey || e.metaKey;
  if (chord && !CHORDS.has(e.key) && !panSheetKey(e)) {
    return 'control';
  }
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
export function latinKey(e: { key: string; code: string; shiftKey?: boolean }): string {
  // Caps Lock changes the letter's case and nothing else: the case the table
  // reads is Shift's. With it on, Ctrl+Z came as «Z» and redid, A added a
  // layer and H flipped the frame upside down.
  const shift = e.shiftKey;
  if (shift !== undefined && /^[a-zA-Z]$/.test(e.key)) {
    return shift ? e.key.toUpperCase() : e.key.toLowerCase();
  }
  // A dead key types nothing yet — macOS makes Option+E one, US-International
  // the backquote — so it is read by place too, as a lower-case letter.
  const dead = e.key === 'Dead';
  if (!dead && (e.key.length !== 1 || /[\x00-\x7f]/.test(e.key))) {
    return e.key;
  }
  const letterCase = !dead && e.key !== e.key.toLowerCase();
  const upper = shift !== undefined && !dead && e.key.toLowerCase() !== e.key.toUpperCase() ? shift : letterCase;
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
  'a', 'A', 'F7', 'Delete', 'Backspace',
]);

export function repeats(key: string): boolean {
  return HELD.has(key);
}

/**
 * A key a person presses on its own, Shift or not: what the «single-letter
 * keys» setting turns off (keyOwner). Arrows are named keys, not typed ones.
 */
const BARE = /^(?:Shift ?\+ ?)?[^\s←→↑↓]$/;

/** Between keys: a slash, a comma, a semicolon or a word («или»); key names are capitalised. */
const BETWEEN = / \/ |[,;] | \p{Ll}+ /u;

/** A key list — «H / Shift + H», «Y, Ctrl+Shift+Z» — without its bare keys. */
function keysLeft(list: string): string {
  const sep = BETWEEN.exec(list)?.[0] ?? ' / ';
  return list.split(BETWEEN).filter((key) => !BARE.test(key)).join(sep);
}

/**
 * A hint with the bare keys taken out, for when single-letter keys are off:
 * «Карандаш (B)» is «Карандаш», «Шаг вперёд (Y или Ctrl+Shift+Z)» keeps the
 * chord. Nothing is swapped for a Ctrl hint — the owner's call. Text without
 * brackets is read as a key list, the way data-key and the manual spell it.
 */
export function withoutLetterKeys(text: string): string {
  if (!text.includes('(')) {
    return keysLeft(text);
  }
  return text.replace(/\s*\(([^()]*)\)/g, (group, inner: string) => {
    const [keys, ...rest] = inner.split(' — ');
    const left = keysLeft(keys);
    if (left === keys) {
      return group;
    }
    const kept = [left, ...rest].filter((part) => part !== '').join(' — ');
    return kept === '' ? '' : `${group.match(/^\s*/)![0]}(${kept})`;
  });
}
