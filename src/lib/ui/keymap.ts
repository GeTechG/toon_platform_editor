/**
 * The studio's keys as data: which command a press means, and what the person
 * has changed of it. A chord is one spelling — `Ctrl+Shift+z`, `Alt+e`, `+`,
 * `ArrowLeft`, `Space` — the same in the table, the stored settings and the
 * manual; on the screen `chordLabel` writes it for people.
 */
import { latinKey } from './key-owner';

export type Chord = string;

export interface Command {
  id: string;
  defaults: readonly Chord[];
  /**
   * Answers only in that mode; a key there and elsewhere is no clash. `hold`
   * acts while the key is down, and the same key's tap keeps its own command.
   */
  scope?: 'transform' | 'hold';
  /** Runs on while the key is held: more of the same is the point. */
  repeat?: boolean;
}

export interface KeyPressEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'CapsLock', 'Dead', 'Unidentified', 'Process']);

/** Signs a non-Latin layout types elsewhere: «б» stands where the comma does. */
const SIGN_BY_PLACE: Record<string, string> = { Comma: ',', Period: '.', Semicolon: ';', Quote: "'", Slash: '/' };

/** Two faces of one key: the person presses «the plus», not «equals with Shift». */
const SAME_KEY: Record<string, string> = { '=': '+', _: '-', '`': '~' };

/** The press as the table spells it; null while only a modifier is down. */
export function chordOf(e: KeyPressEvent): Chord | null {
  let key = latinKey({ key: e.key, code: e.code, shiftKey: e.shiftKey });
  if (MODIFIERS.has(key)) {
    return null;
  }
  if (key === ' ') {
    key = 'Space';
  } else if (key.length === 1) {
    if (/[^\x00-\x7f]/.test(key)) {
      key = SIGN_BY_PLACE[e.code] ?? key.toLowerCase();
    }
    key = SAME_KEY[key] ?? key;
    key = key.toLowerCase();
  }
  // A letter or a named key holds Shift as a modifier; a sign has it in itself.
  const shifted = e.shiftKey && (key.length > 1 || /^[a-z]$/.test(key));
  return `${e.ctrlKey || e.metaKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${shifted ? 'Shift+' : ''}${key}`;
}

export interface ResolveContext {
  /** A live transform: its own commands come first. */
  transform?: boolean;
  /** Asks only for a command that acts while its key is held. */
  hold?: boolean;
  /** Whether a command is here now: a tool off the panel leaves its key to the next holder. */
  available?: (id: string) => boolean;
}

export interface Keymap {
  /** The command a chord means now, or null when nothing holds it. */
  resolve(chord: Chord, context?: ResolveContext): string | null;
  /** The keys a command answers to now, its changed ones first in the order given. */
  bindings(id: string): readonly Chord[];
  /** Its keys that reach it now: one another command here takes first does not. */
  effective(id: string, available: (id: string) => boolean): readonly Chord[];
  /** Whether the person has changed this command's keys. */
  changed(id: string): boolean;
  /** Whether the command runs on while its key is held. */
  repeats(id: string): boolean;
  /** Whether its keys differ from the defaults, which is what hints are written with. */
  moved(id: string): boolean;
}

export type KeyOverrides = Readonly<Record<string, readonly Chord[]>>;

const scopeOf = (command: Command): string => command.scope ?? 'studio';

export function buildKeymap(commands: readonly Command[], overrides: KeyOverrides): Keymap {
  const holders = new Map<string, Command[]>();
  const hold = (command: Command, chord: Chord): void => {
    const at = `${scopeOf(command)} ${chord}`;
    holders.set(at, [...(holders.get(at) ?? []), command]);
  };
  // A key the person chose comes first: a default that lands on it later (a
  // new plugin's) does not take it from them. One a command had by default
  // keeps the table's order, whoever's list it stands in: adding a key to
  // fullscreen does not take F from the pen.
  const chosen = (command: Command, chord: Chord): boolean => !command.defaults.includes(chord);
  const keysOf = (command: Command): readonly Chord[] => overrides[command.id] ?? command.defaults;
  for (const command of commands) {
    for (const chord of keysOf(command)) {
      if (chosen(command, chord)) hold(command, chord);
    }
  }
  for (const command of commands) {
    for (const chord of keysOf(command)) {
      if (!chosen(command, chord)) hold(command, chord);
    }
  }
  const byId = new Map(commands.map((command) => [command.id, command]));
  const first = (scope: string, chord: Chord, available: (id: string) => boolean): string | null =>
    holders.get(`${scope} ${chord}`)?.find((command) => available(command.id))?.id ?? null;
  return {
    resolve(chord, context = {}) {
      const available = context.available ?? (() => true);
      const plain = chord.replace('Shift+', '');
      const scopes = context.hold ? ['hold'] : context.transform ? ['transform', 'studio'] : ['studio'];
      for (const scope of scopes) {
        // A Shift that means nothing of its own is the same key.
        const found = first(scope, chord, available) ?? first(scope, plain, available);
        if (found) {
          return found;
        }
      }
      return null;
    },
    bindings(id) {
      const command = byId.get(id);
      if (!command) {
        return [];
      }
      const own = overrides[id] ?? command.defaults;
      // A row names a key only if the key would reach it: one a changed row
      // holds is not this default's any more. Sharing by design (a tool off
      // the panel and what stands in for it) is told by the whole list.
      return own.filter((chord) => {
        const list = holders.get(`${scopeOf(command)} ${chord}`) ?? [];
        return !!overrides[id] || !list.some((other) => other.id !== id && chosen(other, chord));
      });
    },
    effective(id, available) {
      const scope = byId.get(id)?.scope;
      return this.bindings(id).filter((chord) => this.resolve(chord, { transform: scope === 'transform', hold: scope === 'hold', available }) === id);
    },
    changed: (id) => overrides[id] !== undefined,
    repeats: (id) => byId.get(id)?.repeat === true,
    moved(id) {
      const defaults = byId.get(id)?.defaults ?? [];
      const now = this.bindings(id);
      return now.length !== defaults.length || now.some((chord) => !defaults.includes(chord));
    },
  };
}

/** Who else in the same scope holds the chord now: what the person is asked about. */
export function holdersOf(commands: readonly Command[], overrides: KeyOverrides, chord: Chord, asker: string): string[] {
  const map = buildKeymap(commands, overrides);
  const scope = scopeOf(commands.find((command) => command.id === asker) ?? { id: asker, defaults: [] });
  return commands
    .filter((command) => command.id !== asker && scopeOf(command) === scope && map.bindings(command.id).includes(chord))
    .map((command) => command.id);
}

function withKeys(commands: readonly Command[], overrides: KeyOverrides, id: string, keys: readonly Chord[]): KeyOverrides {
  const command = commands.find((one) => one.id === id);
  const next: Record<string, readonly Chord[]> = { ...overrides };
  const same = command && command.defaults.length === keys.length && command.defaults.every((key) => keys.includes(key));
  // Back where it started is no change at all: the next default it gets is its own.
  if (same) {
    delete next[id];
  } else {
    next[id] = keys;
  }
  return next;
}

/**
 * Gives a command the chord, in place of `replacing` or beside its other
 * keys; whoever else in its scope held the chord lets go of it.
 */
export function assignChord(commands: readonly Command[], overrides: KeyOverrides, id: string, chord: Chord, replacing?: Chord): KeyOverrides {
  let next = overrides;
  for (const holder of holdersOf(commands, overrides, chord, id)) {
    next = removeChord(commands, next, holder, chord);
  }
  const keys = buildKeymap(commands, next).bindings(id);
  const list = replacing !== undefined && keys.includes(replacing)
    ? keys.map((key) => (key === replacing ? chord : key))
    : keys.includes(chord) ? keys : [...keys, chord];
  return withKeys(commands, next, id, [...new Set(list)]);
}

export function removeChord(commands: readonly Command[], overrides: KeyOverrides, id: string, chord: Chord): KeyOverrides {
  return withKeys(commands, overrides, id, buildKeymap(commands, overrides).bindings(id).filter((key) => key !== chord));
}

/** The command's own keys again; one someone else was given since stays theirs. */
export function resetCommand(overrides: KeyOverrides, id: string): KeyOverrides {
  const next: Record<string, readonly Chord[]> = { ...overrides };
  delete next[id];
  return next;
}

/** Keys the studio or the page need as they are (WCAG 2.1.2: Tab leaves the sheet). */
const FIXED = new Set(['Tab', 'Enter', 'Escape']);
/** What a browser or a system does not let a page have, or keeps a person from getting back. */
const BROWSER = new Set(['Ctrl+t', 'Ctrl+w', 'Ctrl+n', 'Ctrl+q', 'Ctrl+r', 'Ctrl+Shift+t', 'Ctrl+Shift+w', 'Ctrl+Shift+n', 'Ctrl+Shift+q', 'Ctrl+Shift+r', 'F5', 'F11', 'F12', 'Ctrl+F5', 'Alt+F4', 'Ctrl+Tab', 'Ctrl+Shift+Tab']);

/** Why this chord cannot be given, or null when it can. */
export function refusal(chord: Chord): 'fixed' | 'browser' | null {
  const key = chord.slice(chord.lastIndexOf('+') + 1) || '+';
  if (FIXED.has(key) && !chord.startsWith('Ctrl+')) {
    return 'fixed';
  }
  if (BROWSER.has(chord) || /^Alt\+Arrow/.test(chord) || chord.startsWith('Ctrl+Alt+')) {
    return 'browser';
  }
  return FIXED.has(key) ? 'fixed' : null;
}

/** The chord in the table's spelling, from a manifest or from storage; null when it is none. */
export function normalizeChord(text: string): Chord | null {
  const trimmed = text.trim();
  if (trimmed === '') {
    return null;
  }
  const parts = trimmed === '+' ? ['+'] : trimmed.replace(/\+\+$/, '+plus').split('+');
  const raw = parts.pop()!.replace(/^plus$/, '+');
  const mods = new Set(parts.map((part) => part.trim().toLowerCase()));
  let key = raw.trim();
  if (key === ' ') {
    key = 'Space';
  }
  if (key.length === 1) {
    key = SAME_KEY[key] ?? key;
    key = key.toLowerCase();
  }
  return `${mods.has('ctrl') ? 'Ctrl+' : ''}${mods.has('alt') ? 'Alt+' : ''}${mods.has('shift') ? 'Shift+' : ''}${key}`;
}

/** What storage hands back, kept only where it is a list of keys that may be given. */
export function readOverrides(value: unknown): KeyOverrides {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const read: Record<string, Chord[]> = {};
  for (const [id, list] of Object.entries(value)) {
    if (Array.isArray(list)) {
      read[id] = list.filter((chord): chord is string => typeof chord === 'string' && chord !== '' && refusal(chord) === null);
    }
  }
  return read;
}

const NAMES: Record<string, string> = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  Delete: 'Del', PageUp: 'PgUp', PageDown: 'PgDn', '-': '−',
};

function splitChord(chord: Chord): { mods: string[]; key: string } {
  const key = chord.endsWith('+') ? '+' : chord.slice(chord.lastIndexOf('+') + 1);
  const mods = chord.slice(0, chord.length - key.length).split('+').filter(Boolean);
  return { mods, key };
}

/** The chord as a person reads it on a key cap. */
export function chordLabel(chord: Chord): string {
  const { mods, key } = splitChord(chord);
  const name = NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  return [...mods, name].join('+');
}

/** The chord in `aria-keyshortcuts` grammar. */
export function chordAria(chord: Chord): string {
  const { mods, key } = splitChord(chord);
  const name = key.length === 1 ? key.toUpperCase() : key;
  return [...mods.map((mod) => (mod === 'Ctrl' ? 'Control' : mod)), name].join('+');
}

/** A tool as the register has it: its id and the keys that pick it up. */
export interface ToolKeys {
  id: string;
  keys: readonly string[];
}

export const toolCommand = (tool: string): string => `tool:${tool}`;

const held = (id: string, ...defaults: Chord[]): Command => ({ id, defaults, repeat: true });
const once = (id: string, ...defaults: Chord[]): Command => ({ id, defaults });

/**
 * Every command the studio's keys reach. Which section a command is listed
 * under, and in what words, is the manual's (manual-sections.ts). The pen and
 * fullscreen share F on purpose: the tools come first, and a tool off the
 * panel leaves the key to what follows it.
 */
export function studioCommands(tools: readonly ToolKeys[]): Command[] {
  return [
    ...tools.map((tool): Command => ({
      id: toolCommand(tool.id),
      defaults: tool.keys.flatMap((key) => normalizeChord(key) ?? []),
    })),
    held('brush-bigger', '+'),
    held('brush-smaller', '-'),
    once('swap', 'x'),
    held('undo', 'z', 'Ctrl+z'),
    held('redo', 'y', 'Ctrl+Shift+z', 'Ctrl+y'),
    once('copy', 'c', 'Ctrl+c'),
    once('cut', 'Ctrl+x'),
    once('paste', 'v', 'Ctrl+v'),
    once('merge', 'm', 'Ctrl+m'),
    once('mirror-h', 'h'),
    once('mirror-v', 'Shift+h'),
    held('frame-prev', 'ArrowLeft'),
    held('frame-next', 'ArrowRight'),
    once('frame-first', 'j'),
    once('frame-last', 'l'),
    held('layer-up', 'ArrowUp'),
    held('layer-down', 'ArrowDown'),
    held('extend-left', 'Shift+ArrowLeft'),
    held('extend-right', 'Shift+ArrowRight'),
    held('extend-up', 'Shift+ArrowUp'),
    held('extend-down', 'Shift+ArrowDown'),
    held('add-frame', 'a', 'F7'),
    held('add-frame-before', 'Ctrl+a', 'Ctrl+F7'),
    once('duplicate-frame', 'g'),
    held('delete-frame', 'Delete', 'Backspace'),
    held('add-layer', 'Shift+a', 'Shift+F7'),
    held('add-layer-before', 'Ctrl+Shift+a', 'Ctrl+Shift+F7'),
    held('delete-layer', 'Shift+Delete', 'Shift+Backspace'),
    once('onion', 'k'),
    once('play', 'Space'),
    once('play-from-active', 'Shift+Space'),
    held('zoom-in', 'Ctrl++'),
    held('zoom-out', 'Ctrl+-'),
    held('pan-left', 'Ctrl+Shift+ArrowLeft'),
    held('pan-right', 'Ctrl+Shift+ArrowRight'),
    held('pan-up', 'Ctrl+Shift+ArrowUp'),
    held('pan-down', 'Ctrl+Shift+ArrowDown'),
    // Held, the sheet moves under the pointer; tapped, the key keeps its own
    // command (Space plays): Photoshop, Krita and Animate pan on Space too.
    { id: 'pan-hold', defaults: ['Space'], scope: 'hold' },
    held('turn-left', '['),
    held('turn-right', ']'),
    once('fullscreen', 'f'),
    { id: 'transform-turn-left', defaults: ['q'], scope: 'transform', repeat: true },
    { id: 'transform-turn-right', defaults: ['w'], scope: 'transform', repeat: true },
    once('save', 'Ctrl+s'),
    once('export', 'Alt+s'),
    once('error-log', 'Alt+l'),
  ];
}

/** A key typed on its own, Shift or not: what the single-letter setting turns off (key-owner.ts). */
export function isBare(chord: Chord): boolean {
  const { mods, key } = splitChord(chord);
  return key.length === 1 && mods.every((mod) => mod === 'Shift');
}

/**
 * A hint with its first brackets naming the keys it has now. Only for a
 * command whose keys moved: otherwise the text as written is already right.
 */
export function rewriteHint(text: string, labels: readonly string[]): string {
  return text.replace(/\s*\(([^()]*)\)/, (group, inner: string) => {
    const [, ...rest] = inner.split(' — ');
    const keys = labels.join(' / ');
    const kept = [keys, ...rest].filter((part) => part !== '').join(' — ');
    return kept === '' ? '' : `${group.match(/^\s*/)![0]}(${kept})`;
  });
}

/**
 * A key that acts while it is down: `start` on the press, `end` on the
 * release, and `tap` after it when nothing used the hold in between.
 */
export function holdKey(on: { start: () => void; end: () => void; tap: () => void }): {
  readonly held: boolean;
  /** Whether this is the key being held. */
  holds(code: string): boolean;
  down(code: string): void;
  use(): void;
  up(code: string): void;
  cancel(): void;
} {
  let code: string | null = null;
  let used = false;
  const release = (tap: boolean): void => {
    if (code === null) return;
    code = null;
    on.end();
    if (tap && !used) on.tap();
  };
  return {
    get held() {
      return code !== null;
    },
    holds: (pressed) => code !== null && pressed === code,
    down(pressed) {
      if (code !== null) return;
      code = pressed;
      used = false;
      on.start();
    },
    use() {
      used = true;
    },
    up(pressed) {
      if (pressed === code) release(true);
    },
    cancel() {
      release(false);
    },
  };
}
