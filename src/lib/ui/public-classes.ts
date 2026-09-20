/**
 * The classes a plugin may lean on.
 *
 * They are declared `:global()` under `.editor` (Editor.svelte), so any node
 * inside the editor gets them — including one a plugin wrote by hand, with no
 * CSS of its own. That is what makes a plugin's button look like the editor's
 * own; the tokens come down the cascade the same way and need no list.
 *
 * Everything else that happens to be `:global()` stays internal and may be
 * renamed without notice. This list is the contract, so it is kept short.
 */
export const PUBLIC_CLASSES: readonly string[] = [
  'key',
  'saved',
  'toggle',
  'toggle-label',
  'sheet',
  'sheet-head',
  'sheet-body',
  'sheet-foot',
  'sheet-hint',
];
