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

import type { FeatureKey } from './presets';
import type { IconName } from './Icon.svelte';
import type { SelectableTool } from './ux-profile';

/**
 * The tool keys, as the reference draws them. `key` is the shortcut the button
 * shows in place of its icon on hover (reference `.control p`); it is spelled
 * out in the title as well.
 */
export const TOOL_KEYS: Record<SelectableTool, { icon: IconName; title: string; label: string; key: string }> = {
  pencil: { icon: 'pencil', title: 'Карандаш (B)', label: 'Карандаш', key: 'B' },
  eraser: { icon: 'eraser', title: 'Ластик (E)', label: 'Ластик', key: 'E' },
  feather: { icon: 'feather', title: 'Перо (F) — обводка и заливка', label: 'Перо', key: 'F' },
  'mega-eraser': {
    icon: 'mega-eraser',
    title: 'Мега-ластик (Alt+E) — режет линии целиком',
    label: 'Мега-ластик',
    key: 'Alt+E',
  },
  pipette: { icon: 'pipette', title: 'Пипетка (P) — ещё раз: взять цвет с экрана', label: 'Пипетка', key: 'P' },
  drag: { icon: 'hand', title: 'Рука (D) — двигать холст', label: 'Рука', key: 'D' },
  lasso: { icon: 'lasso', title: 'Лассо (Q) — взять кадр и трансформировать', label: 'Лассо', key: 'Q' },
  distort: { icon: 'distort', title: 'Искажение (~) — дребезг штрихов кадра', label: 'Искажение', key: '~' },
  pixel: { icon: 'pixel', title: 'Пиксель — рисует по сетке', label: 'Пиксель', key: '' },
};

/** Rail order: every tool the editor has, the profile decides which are drawn. */
const TOOL_ORDER: readonly SelectableTool[] = [
  'pencil',
  'eraser',
  'feather',
  'mega-eraser',
  'pipette',
  'drag',
  'lasso',
  'distort',
  'pixel',
];

/** A tool's item id — one item per tool, so each key is placed on its own. */
export function toolItem(tool: SelectableTool): string {
  return `tool:${tool}`;
}

/** The tool an item selects, or null when the item is not a tool key. */
export function toolOfItem(id: string): SelectableTool | null {
  const tool = id.startsWith('tool:') ? id.slice(5) as SelectableTool : null;
  return tool && tool in TOOL_KEYS ? tool : null;
}

/**
 * Where an item can go. The bottom panel is however many rows the user made:
 * `row:N` is one of them, `newrow:N` is the gap between them — dropping there
 * makes a row. The rest are the two side columns, the canvas and the shelf.
 */
export type PanelSlot = 'left' | 'right' | 'float' | 'hidden' | `row:${number}` | `newrow:${number}`;
/** The slots that are always there, whatever the rows are doing. */
export const FIXED_SLOTS = ['left', 'right', 'float', 'hidden'] as const;

const FIXED_LABELS: Record<(typeof FIXED_SLOTS)[number], string> = {
  left: 'Слева',
  right: 'Справа',
  float: 'Поверх холста',
  hidden: 'Скрытые',
};

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
    return row.fresh ? 'Новая строка' : `Строка ${row.index + 1}`;
  }
  return FIXED_LABELS[slot as (typeof FIXED_SLOTS)[number]] ?? slot;
}

/** Kept for the settings list: the same label table, by slot. */
export const SLOT_LABELS = FIXED_LABELS;

/**
 * `tool` — picks up something to draw with; `action` — does a thing and hands
 * the canvas back; `widget` — a control that is its own setting.
 */
export type PanelItemKind = 'tool' | 'action' | 'widget';

export const KIND_LABELS: Record<PanelItemKind, string> = {
  tool: 'инструмент',
  action: 'действие',
  widget: 'виджет',
};

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

export const PANEL_ITEMS: readonly PanelItem[] = [
  ...TOOL_ORDER.map((tool): PanelItem => ({
    id: toolItem(tool),
    kind: 'tool',
    label: TOOL_KEYS[tool].label,
  })),
  { id: 'pick-source', kind: 'widget', label: 'Источник пипетки', wide: true },
  { id: 'save', kind: 'action', label: 'Сохранить черновик' },
  { id: 'history', kind: 'action', label: 'Отменить / вернуть', wide: true },
  { id: 'manual', kind: 'action', label: 'Мануал' },
  { id: 'fullscreen', kind: 'action', label: 'Полный экран' },
  { id: 'drafts', kind: 'action', label: 'Локальные сохранения' },
  { id: 'palette', kind: 'widget', wide: true, label: 'Цвет' },
  { id: 'brush', kind: 'widget', wide: true, label: 'Кисть' },
  { id: 'timeline', kind: 'widget', wide: true, label: 'Лента кадров' },
  { id: 'transport', kind: 'widget', label: 'Управление воспроизведением' },
  { id: 'add-frame', kind: 'action', label: 'Добавить кадр' },
  { id: 'delete-frame', kind: 'action', label: 'Удалить кадр' },
  { id: 'onion', kind: 'action', label: 'Калька' },
  { id: 'fps', kind: 'widget', wide: true, label: 'Частота кадров' },
  { id: 'zoom', kind: 'widget', wide: true, label: 'Масштаб' },
  { id: 'audio', kind: 'widget', label: 'Звук' },
  { id: 'export', kind: 'action', label: 'Экспорт' },
  { id: 'saved', kind: 'widget', wide: true, label: 'Отметка о сохранении' },
  { id: 'copy', kind: 'action', label: 'Копировать' },
  { id: 'paste', kind: 'action', label: 'Вставить' },
  { id: 'merge', kind: 'action', label: 'Объединить' },
  { id: 'settings', kind: 'action', label: 'Настройки', keep: true },
  { id: 'publish', kind: 'action', label: 'Опубликовать' },
];

export interface PanelLayout {
  left: string[];
  right: string[];
  /** The bottom panel, top row first; a row that empties is removed. */
  rows: string[][];
  /** Windows over the canvas. */
  float: string[];
  hidden: string[];
}
/** Which layout the preset draws: the toonio.ru studio, or one bar under the canvas. */
export type LayoutKind = 'studio' | 'bar';

/** Feature flag ↔ item: a preset that drops a button starts with it hidden. */
export const FEATURE_ITEM: Record<FeatureKey, string> = {
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
 * The studio arrangement (toonio.ru): tools down the left, colour and brush on
 * the right, the strip over a transport row. Anything left out is hidden — the
 * layers popup, because the studio strip carries the rows itself.
 */
const STUDIO: Omit<PanelLayout, 'float' | 'hidden'> = {
  left: [...TOOL_ORDER.map(toolItem), 'save', 'pick-source', 'history', 'manual', 'fullscreen', 'drafts'],
  right: ['palette', 'brush'],
  rows: [['timeline'], [
    'transport',
    'add-frame',
    'delete-frame',
    'onion',
    'fps',
    'zoom',
    'audio',
    'export',
    'saved',
    'copy',
    'paste',
    'merge',
    'settings',
    'publish',
  ]],
};

/** One bar under the canvas (Multator): frames, transport, drawing. */
const BAR: Omit<PanelLayout, 'float' | 'hidden'> = {
  left: [],
  right: [],
  rows: [
    ['history', 'add-frame', 'delete-frame', 'timeline'],
    [
      'transport',
      'onion',
      'fps',
      'zoom',
      'audio',
      'export',
      'saved',
      'drafts',
      'fullscreen',
      'settings',
      'publish',
    ],
    // Reference order: the keys, the hairline the brush draws, then its sizes,
    // then the two colour swatches.
    [...TOOL_ORDER.map(toolItem), 'pick-source', 'brush', 'palette'],
  ],
};

function emptyLayout(): PanelLayout {
  return { left: [], right: [], rows: [], float: [], hidden: [] };
}

/** Every item the layout draws somewhere, in reading order. */
export function allPlaced(layout: PanelLayout): string[] {
  return [...layout.left, ...layout.right, ...layout.rows.flat(), ...layout.float, ...layout.hidden];
}

/** The arrangement a layout starts from; every item it does not place is hidden. */
export function defaultPanels(layout: LayoutKind): PanelLayout {
  const base = layout === 'bar' ? BAR : STUDIO;
  const next: PanelLayout = {
    left: [...base.left],
    right: [...base.right],
    rows: base.rows.map((row) => [...row]),
    float: [],
    hidden: [],
  };
  const placed = new Set(allPlaced(next));
  next.hidden = PANEL_ITEMS.filter((item) => !placed.has(item.id)).map((item) => item.id);
  return next;
}

/** What sits in a slot; a row that does not exist yet holds nothing. */
export function itemsOf(layout: PanelLayout, slot: PanelSlot): string[] {
  const row = slotRow(slot);
  if (row) {
    return row.fresh ? [] : layout.rows[row.index] ?? [];
  }
  return layout[slot as 'left' | 'right' | 'float' | 'hidden'] ?? [];
}

/** The slots this layout offers now: its rows, plus one more to make. */
export function slotsOf(layout: PanelLayout, kind: LayoutKind): PanelSlot[] {
  const columns: PanelSlot[] = kind === 'studio' ? ['left', 'right'] : [];
  return [
    ...columns,
    ...layout.rows.map((_, i) => rowSlot(i)),
    newRowSlot(layout.rows.length),
    'float',
    'hidden',
  ];
}

export function panelItem(id: string): PanelItem | undefined {
  return PANEL_ITEMS.find((item) => item.id === id);
}

/**
 * A stored layout, cleaned: unknown ids and repeats dropped, and any item the
 * stored layout never mentioned put back where its layout default has it — so
 * a button added in a later version is not invisible to everyone who has
 * already arranged their panels once.
 */
export function normalizePanels(value: unknown, layout: LayoutKind): PanelLayout {
  const stored = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  const next = emptyLayout();
  const seen = new Set<string>();
  const take = (list: unknown): string[] => {
    const out: string[] = [];
    for (const id of Array.isArray(list) ? list : []) {
      if (typeof id === 'string' && panelItem(id) && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  };
  next.left = take(stored.left);
  next.right = take(stored.right);
  // Rows as stored, or — for a layout written when the bottom panel had three
  // fixed rows — those three, in the order they were drawn.
  const rows = Array.isArray(stored.rows)
    ? stored.rows
    : [stored.bottom, stored.bar, stored.draw];
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
  const fallback = defaultPanels(layout);
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
    const into = next[slot as 'left' | 'right' | 'float' | 'hidden'];
    into.splice(Math.max(0, Math.min(into.length, index ?? into.length)), 0, id);
  }
  next.rows = next.rows.filter((list) => list.length > 0);
  return next;
}

/** Back into the slot the layout default gives it. */
export function showPanelItem(layout: PanelLayout, id: string, kind: LayoutKind): PanelLayout {
  const home = defaultPanels(kind);
  if (home.left.includes(id)) {
    return movePanelItem(layout, id, 'left');
  }
  if (home.right.includes(id)) {
    return movePanelItem(layout, id, 'right');
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
  return PANEL_ITEMS.some((item) => toolOfItem(item.id) !== null && panelItemVisible(layout, item.id));
}

/** Whether the item is drawn at all. */
export function panelItemVisible(layout: PanelLayout, id: string): boolean {
  return !layout.hidden.includes(id);
}
