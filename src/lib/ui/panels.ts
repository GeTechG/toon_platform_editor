/**
 * Panel contents: what sits in each panel of the editor, in what order.
 *
 * Every movable piece of chrome is an item with an id and a kind — a
 * selectable tool rail, a side action (onion skin, fullscreen), or a widget
 * that is a control in itself (timeline, palette, transport). A layout maps
 * a slot to the items in it; anything in `hidden` is not drawn at all.
 *
 * Pure data + pure functions, so `bun test` covers it and the runes state
 * stays a thin caller. The layout is persisted with the rest of the UI config.
 */

import { plugins } from '../plugins';
import type { RegisteredTool } from '../plugins/registry';
import { t } from '../i18n';

/** What the rail draws for a tool, whoever added it. */
export function toolSpec(tool: string): RegisteredTool | undefined {
  return plugins.tool(tool);
}

/**
 * The second key a built-in tool answers to, as the reference binds it: the
 * hand is D or O, the lasso Q or S (Editor.svelte's key table). A plugin's
 * tool has the one key its manifest names.
 */
const SECOND_KEY: Readonly<Record<string, string>> = { drag: 'O', lasso: 'S' };

/** Every key that picks the tool up, the registered one first; none for a tool without. */
export function toolKeyList(tool: string): string[] {
  const spec = toolSpec(tool);
  if (!spec?.key) {
    return [];
  }
  const second = spec.builtin ? SECOND_KEY[tool] : undefined;
  return second ? [spec.key, second] : [spec.key];
}

/** Every tool the editor has now, in the order it was registered. */
export function toolOrder(): string[] {
  return onPanel().map((tool) => tool.id);
}

/** Every tool the arrangement may place — all but the ones reached by a gesture. */
function onPanel(): readonly RegisteredTool[] {
  return plugins.tools().filter((tool) => !tool.offPanel);
}

/** A tool's item id — one item per tool, so each key is placed on its own. */
export function toolItem(tool: string): string {
  return `tool:${tool}`;
}

/** The tool an item selects, or null when the item is not a tool key. */
export function toolOfItem(id: string): string | null {
  const tool = id.startsWith('tool:') ? id.slice(5) : null;
  return tool && plugins.tool(tool) ? tool : null;
}

/**
 * Where an item can go. The bottom panel is however many rows the user made:
 * `row:N` is one of them, `newrow:N` is the gap between them — dropping there
 * makes a row. The rest are the two side columns, the bar over the canvas,
 * the canvas and the shelf.
 */
export type PanelSlot = 'left' | 'right' | 'top' | 'float' | 'hidden' | `row:${number}` | `newrow:${number}`;
/** The slots that are always there, whatever the rows are doing. */
export const FIXED_SLOTS = ['left', 'right', 'top', 'float', 'hidden'] as const;



export function rowSlot(index: number): PanelSlot {
  return `row:${index}`;
}

export function newRowSlot(index: number): PanelSlot {
  return `newrow:${index}`;
}

/** The row a slot names, or null when it names something else. */
export function slotRow(slot: PanelSlot): { index: number; fresh: boolean } | null {
  const row = /^(new)?row:(\d+)$/.exec(slot);
  return row ? { index: Number(row[2]), fresh: row[1] === 'new' } : null;
}

export function slotLabel(slot: PanelSlot): string {
  const row = slotRow(slot);
  if (row) {
    return row.fresh ? t('panel.row_new') : t('panel.row', { n: row.index + 1 });
  }
  return (FIXED_SLOTS as readonly string[]).includes(slot) ? t(`panel.${slot}`) : slot;
}

/**
 * `tool` — picks up something to draw with; `action` — does a thing and hands
 * the canvas back; `widget` — a control that is its own setting.
 */
export type PanelItemKind = 'tool' | 'action' | 'widget';

export function kindLabel(kind: PanelItemKind): string {
  return t(`panel.kind.${kind}`);
}

export interface PanelItem {
  readonly id: string;
  readonly kind: PanelItemKind;
  readonly label: string;
  /**
   * Wider than a key: in a side column it takes a whole row rather than one
   * cell of the key grid (the palette box, the strip, a slider pair).
   */
  readonly wide?: boolean;
  /**
   * Movable, but never put away: the gear holds the way back to the settings,
   * so a layout that hides it could not be undone.
   */
  readonly keep?: boolean;
}

/** Everything that is not a tool: the tools come from the register. */
function fixedItems(): readonly PanelItem[] {
  return [
  { id: 'save', kind: 'action', label: t('panel.item.save') },
  { id: 'history', kind: 'action', label: t('panel.item.history'), wide: true },
  { id: 'manual', kind: 'action', label: t('panel.item.manual') },
  { id: 'fullscreen', kind: 'action', label: t('panel.item.fullscreen') },
  { id: 'drafts', kind: 'action', label: t('panel.item.drafts') },
  { id: 'palette', kind: 'widget', wide: true, label: t('panel.item.palette') },
  { id: 'brush', kind: 'widget', wide: true, label: t('panel.item.brush') },
  // The plain pair, for whoever wants a key instead of a box.
  { id: 'color', kind: 'widget', label: t('panel.item.color') },
  // A key each, the box behind it: the top bar's form of the two (toonop).
  { id: 'brush-key', kind: 'widget', label: t('panel.item.brush_key') },
  { id: 'color-key', kind: 'widget', label: t('panel.item.color_key') },
  { id: 'brush-sizes', kind: 'widget', wide: true, label: t('panel.item.brush_sizes') },
  { id: 'timeline', kind: 'widget', wide: true, label: t('panel.item.timeline') },
  { id: 'transport', kind: 'widget', label: t('panel.item.transport') },
  { id: 'add-frame', kind: 'action', label: t('panel.item.add_frame') },
  { id: 'delete-frame', kind: 'action', label: t('panel.item.delete_frame') },
  { id: 'onion', kind: 'action', label: t('panel.item.onion') },
  { id: 'fps', kind: 'widget', wide: true, label: t('panel.item.fps') },
  { id: 'audio', kind: 'widget', label: t('panel.item.audio') },
  { id: 'export', kind: 'action', label: t('panel.item.export') },
  { id: 'saved', kind: 'widget', wide: true, label: t('panel.item.saved') },
  { id: 'copy', kind: 'action', label: t('panel.item.copy') },
  { id: 'paste', kind: 'action', label: t('panel.item.paste') },
  { id: 'merge', kind: 'action', label: t('panel.item.merge') },
  { id: 'settings', kind: 'action', label: t('panel.item.settings'), keep: true },
  { id: 'publish', kind: 'action', label: t('panel.item.publish') },
  ];
}

/**
 * Every item the panels can hold: the tools the register has right now, then
 * the rest. A function rather than a table, because a plugin can arrive (or
 * go) after this module was loaded.
 */
export function panelItems(): readonly PanelItem[] {
  return [
    ...onPanel().map((tool): PanelItem => ({
      id: toolItem(tool.id),
      kind: 'tool',
      label: tool.label,
    })),
    ...fixedItems(),
  ];
}

export interface PanelLayout {
  left: string[];
  right: string[];
  /** The bar over the canvas, drawn only when it holds something. */
  top: string[];
  /** The bottom panel, top row first; a row that empties is removed. */
  rows: string[][];
  /** Windows over the canvas. */
  float: string[];
  hidden: string[];
}

/**
 * Legacy flag ↔ item. Configs written before the arrangement existed carry
 * a map of on/off flags; this is how they are read back (see parseUiConfig).
 */
export const FEATURE_ITEM: Record<string, string> = {
  addFrame: 'add-frame',
  deleteFrame: 'delete-frame',
  timeline: 'timeline',
  play: 'transport',
  export: 'export',
  tools: toolItem('pencil'),
  sizes: 'brush',
  color: 'palette',
  onionSkin: 'onion',
};

/**
 * The studio arrangement: tools down the left with what leaves the editor
 * under them (draft, export, publish) and what is about the editor itself at
 * the bottom, colour and brush on the right, the keys over the strip — the
 * strip sits right above the canvas, where the hand leaves it. Anything left
 * out is hidden — the plain colour and thickness pair, because the boxes are
 * on the right, and the cell keys (delete, copy, paste, merge), because a
 * right press on the cell itself brings them.
 */
function defaultBase(): Omit<PanelLayout, 'float' | 'hidden'> {
  return {
  left: [
    ...toolOrder().map(toolItem),
    'save',
    'export',
    'publish',
    'history',
    'fullscreen',
    'manual',
  ],
  right: ['palette', 'brush'],
  top: [],
  rows: [[
    'fps',
    'transport',
    'add-frame',
    'onion',
    'audio',
    'settings',
    'drafts',
    'saved',
  ], ['timeline']],
  };
}

function emptyLayout(): PanelLayout {
  return { left: [], right: [], top: [], rows: [], float: [], hidden: [] };
}

/** Every item the layout draws somewhere, in reading order. */
export function allPlaced(layout: PanelLayout): string[] {
  return [...layout.left, ...layout.right, ...layout.top, ...layout.rows.flat(), ...layout.float, ...layout.hidden];
}

/**
 * The arrangement the editor starts from — the same one for every preset: a
 * preset changes how the editor behaves (the brush above all), never where
 * the buttons are. Anything not placed here waits on the shelf.
 */
export function defaultPanels(): PanelLayout {
  return layoutOf(defaultBase());
}

/** What sits in a slot; a row that does not exist yet holds nothing. */
export function itemsOf(layout: PanelLayout, slot: PanelSlot): string[] {
  const row = slotRow(slot);
  if (row) {
    return row.fresh ? [] : layout.rows[row.index] ?? [];
  }
  return layout[slot as (typeof FIXED_SLOTS)[number]] ?? [];
}

/** The slots this layout offers now: its rows, plus one more to make. */
export function slotsOf(layout: PanelLayout): PanelSlot[] {
  return [
    'left',
    'right',
    'top',
    ...layout.rows.map((_, i) => rowSlot(i)),
    newRowSlot(layout.rows.length),
    'float',
    'hidden',
  ];
}

/** Where an item sits now, or null when it is nowhere (not even the shelf). */
export function slotOf(layout: PanelLayout, id: string): { slot: PanelSlot; index: number } | null {
  for (const slot of FIXED_SLOTS) {
    const index = layout[slot].indexOf(id);
    if (index >= 0) {
      return { slot, index };
    }
  }
  for (const [i, row] of layout.rows.entries()) {
    const index = row.indexOf(id);
    if (index >= 0) {
      return { slot: rowSlot(i), index };
    }
  }
  return null;
}

/**
 * What a preset starts with: the one arrangement, with a few things taken out
 * and a few swapped for another form of the same control (Multator draws its
 * own colour pair rather than the palette box).
 */
export interface PresetPanels {
  /** Its own starting arrangement, when the default is not the shape it wants. */
  readonly base?: Partial<Omit<PanelLayout, 'hidden'>>;
  readonly hide?: readonly string[];
  readonly swap?: readonly (readonly [string, string])[];
}

export function panelsFrom(patch: PresetPanels = {}): PanelLayout {
  let panels = patch.base ? layoutOf(patch.base) : defaultPanels();
  for (const [was, now] of patch.swap ?? []) {
    const at = slotOf(panels, was);
    if (!at) {
      continue;
    }
    panels = hidePanelItem(panels, was);
    panels = movePanelItem(panels, now, at.slot, at.index);
  }
  for (const id of patch.hide ?? []) {
    panels = hidePanelItem(panels, id);
  }
  return panels;
}

/** A layout written out in full: everything it does not place waits on the shelf. */
function layoutOf(base: Partial<Omit<PanelLayout, 'hidden'>>): PanelLayout {
  const next: PanelLayout = {
    left: [...(base.left ?? [])],
    right: [...(base.right ?? [])],
    top: [...(base.top ?? [])],
    rows: (base.rows ?? []).map((row) => [...row]),
    float: [...(base.float ?? [])],
    hidden: [],
  };
  const placed = new Set(allPlaced(next));
  next.hidden = panelItems().filter((item) => !placed.has(item.id)).map((item) => item.id);
  return next;
}

export function panelItem(id: string): PanelItem | undefined {
  return panelItems().find((item) => item.id === id);
}

/**
 * A tool key whose tool is not in the register (yet). Read from storage before
 * the installed plugins are in, it is a key waiting for its plugin, not one
 * whose plugin is gone.
 */
function waitingTool(id: string): boolean {
  return id.startsWith('tool:') && !plugins.tool(id.slice(5));
}

/**
 * A stored layout, cleaned: unknown ids and repeats dropped, and any item the
 * stored layout never mentioned put back where its layout default has it — so
 * a button added in a later version is not invisible to everyone who has
 * already arranged their panels once.
 *
 * `waiting`: the layout is read before the installed plugins are (a reload),
 * so the key of a tool the register does not know yet keeps its place — a
 * reload is not the plugin coming back (owner, 13th audit). The next clean
 * without it, once the plugins are in, drops what is really gone.
 */
export function normalizePanels(value: unknown, waiting = false): PanelLayout {
  const stored = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  const next = emptyLayout();
  const seen = new Set<string>();
  const take = (list: unknown): string[] => {
    const out: string[] = [];
    for (const id of Array.isArray(list) ? list : []) {
      if (typeof id === 'string' && (panelItem(id) || (waiting && waitingTool(id))) && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  };
  next.left = take(stored.left);
  next.right = take(stored.right);
  next.top = take(stored.top);
  // Rows as stored, or — for a layout written when the bottom panel had fixed
  // rows — those, in the order they were drawn. The old `draw` row is left
  // out on purpose: it belonged to a layout with no side columns and held the
  // boxes, which do not fit a row of the bottom panel. Its items fall through
  // to the arrangement below, which puts them back in the columns.
  const rows = Array.isArray(stored.rows)
    ? stored.rows
    : [stored.bottom, stored.bar];
  next.rows = rows.map(take).filter((row) => row.length > 0);
  next.float = take(stored.float);
  next.hidden = take(stored.hidden).filter((id) => {
    // An item that may not be put away (the gear) is read as "not placed":
    // it comes back with its layout default.
    if (!panelItem(id)?.keep) {
      return true;
    }
    seen.delete(id);
    return false;
  });
  const fallback = defaultPanels();
  const restore = (id: string, into: string[]): void => {
    if (!seen.has(id)) {
      seen.add(id);
      into.push(id);
    }
  };
  for (const id of fallback.left) restore(id, next.left);
  for (const id of fallback.right) restore(id, next.right);
  fallback.rows.forEach((row, i) => {
    for (const id of row) {
      if (!seen.has(id)) {
        next.rows[i] ??= [];
        restore(id, next.rows[i]);
      }
    }
  });
  for (const id of fallback.hidden) restore(id, next.hidden);
  next.rows = next.rows.filter((row) => row.length > 0);
  return next;
}

/**
 * The same layout with `id` at `index` of `slot` (the end, when no index is
 * given). A `newrow:` slot makes a row there; a row left empty by the move is
 * removed, so an unreachable strip of nothing can never be left behind.
 */
export function movePanelItem(layout: PanelLayout, id: string, slot: PanelSlot, index?: number): PanelLayout {
  const item = panelItem(id);
  if (!item || (slot === 'hidden' && item.keep)) {
    return layout;
  }
  const without = (list: readonly string[]): string[] => list.filter((other) => other !== id);
  const next: PanelLayout = {
    left: without(layout.left),
    right: without(layout.right),
    top: without(layout.top),
    rows: layout.rows.map(without),
    float: without(layout.float),
    hidden: without(layout.hidden),
  };
  const row = slotRow(slot);
  if (row) {
    // A fresh row, or one past the end, lands as a row of its own.
    const at = Math.max(0, Math.min(next.rows.length, row.index));
    if (row.fresh || at === next.rows.length) {
      next.rows.splice(at, 0, [id]);
    } else {
      const into = next.rows[at];
      into.splice(Math.max(0, Math.min(into.length, index ?? into.length)), 0, id);
    }
  } else {
    const into = next[slot as (typeof FIXED_SLOTS)[number]];
    into.splice(Math.max(0, Math.min(into.length, index ?? into.length)), 0, id);
  }
  next.rows = next.rows.filter((list) => list.length > 0);
  return next;
}

/**
 * Back into the slot `home` (the preset's arrangement) gives it, or the
 * editor's own default where the preset puts it away.
 */
export function showPanelItem(layout: PanelLayout, id: string, preset?: PanelLayout): PanelLayout {
  const home = preset && !preset.hidden.includes(id) ? preset : defaultPanels();
  if (home.left.includes(id)) {
    return movePanelItem(layout, id, 'left');
  }
  if (home.right.includes(id)) {
    return movePanelItem(layout, id, 'right');
  }
  if (home.top.includes(id)) {
    return movePanelItem(layout, id, 'top');
  }
  const rowIndex = home.rows.findIndex((row) => row.includes(id));
  // Its row in the default may not exist here; the last row is close enough.
  const at = rowIndex < 0
    ? Math.max(0, layout.rows.length - 1)
    : Math.min(rowIndex, Math.max(0, layout.rows.length - 1));
  return movePanelItem(layout, id, rowSlot(at));
}

export function hidePanelItem(layout: PanelLayout, id: string): PanelLayout {
  return panelItem(id)?.keep ? layout : movePanelItem(layout, id, 'hidden');
}

/** Whether any tool key at all is still placed somewhere. */
export function anyToolVisible(layout: PanelLayout): boolean {
  return panelItems().some((item) => toolOfItem(item.id) !== null && panelItemVisible(layout, item.id));
}

/**
 * The tools the editor actually has: every tool key the arrangement still
 * places. A preset chooses what that arrangement starts with (presets.ts) —
 * after that it is the panels' business, so a key put back by hand draws and
 * works, and one put away is gone from the hotkeys too.
 */
export function visibleTools(layout: PanelLayout): string[] {
  return toolOrder().filter((tool) => panelItemVisible(layout, toolItem(tool)));
}

/** Whether the item is drawn at all. */
export function panelItemVisible(layout: PanelLayout, id: string): boolean {
  return !layout.hidden.includes(id);
}

/**
 * Whether the full layout has the item on screen: in a window, or in a column
 * or the bar that is not folded away. The preview's loop lives in the
 * transport's key, and with the bar folded Space had nothing to press.
 */
export function itemDrawn(
  layout: PanelLayout,
  id: string,
  folded: { left: boolean; right: boolean; rows: boolean },
): boolean {
  return layout.float.includes(id)
    || layout.top.includes(id)
    || (!folded.left && layout.left.includes(id))
    || (!folded.right && layout.right.includes(id))
    || (!folded.rows && layout.rows.some((row) => row.includes(id)));
}

/**
 * Whether a column has anything to draw. Some items draw nothing where they
 * lie — the pipette's key under a preset that keeps it elsewhere, «Отправить»
 * off the site — and a column holding only those stood as an empty strip
 * taking the canvas's room. A plugin's key not yet registered still counts:
 * it is on its way, and the canvas would jump at every reload.
 */
export function columnDraws(
  ids: readonly string[],
  has: { pipette: boolean; publish: boolean; fullscreen: boolean },
): boolean {
  return ids.some((id) => {
    const tool = toolOfItem(id);
    if (tool) return tool !== 'pipette' || has.pipette;
    if (id === 'publish') return has.publish;
    if (id === 'fullscreen') return has.fullscreen;
    return true;
  });
}

/** Where a window with no place stored is drawn (FloatWindow). */
export const FLOAT_HOME: Readonly<{ x: number; y: number }> = { x: 24, y: 24 };

/** Places closer than this, in px, are the same place: rounding, not a move. */
const FLOAT_JITTER = 2;

/**
 * The same arrangement: every panel in the same order, and — when their
 * places are given — every window where it was (owner, 13th audit). The
 * shelf is a heap, and the order of the windows is only which one was
 * pressed last (their stacking): neither is anybody's work. The places are
 * the stored ones, not the ones a small screen draws them at.
 */
export function samePanels(
  a: PanelLayout,
  b: PanelLayout,
  aPos?: Readonly<Record<string, { x: number; y: number }>>,
  bPos?: Readonly<Record<string, { x: number; y: number }>>,
): boolean {
  const key = (p: PanelLayout) =>
    JSON.stringify([p.left, p.right, p.top, p.rows, [...p.float].sort(), [...p.hidden].sort()]);
  if (key(a) !== key(b)) {
    return false;
  }
  if (!aPos || !bPos) {
    return true;
  }
  return a.float.every((id) => {
    const p = aPos[id] ?? FLOAT_HOME;
    const q = bPos[id] ?? FLOAT_HOME;
    return Math.abs(p.x - q.x) < FLOAT_JITTER && Math.abs(p.y - q.y) < FLOAT_JITTER;
  });
}
