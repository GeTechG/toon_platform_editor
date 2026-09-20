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
 * Where an item can go. `bottom` is the tall row of the bottom panel (the one
 * the divider grows), `bar` the transport row under it, `draw` the drawing row
 * the bar layout keeps for tools and colour.
 */
export type PanelSlot = 'left' | 'right' | 'bottom' | 'bar' | 'draw' | 'float' | 'hidden';
export const PANEL_SLOTS: readonly PanelSlot[] = ['left', 'right', 'bottom', 'bar', 'draw', 'float', 'hidden'];
/** The slots the customization list offers, in reading order. */
export const SLOT_LABELS: Record<PanelSlot, string> = {
  left: 'Слева',
  right: 'Справа',
  bottom: 'Над строкой',
  bar: 'Нижняя строка',
  draw: 'Строка рисования',
  float: 'Поверх холста',
  hidden: 'Скрытые',
};

/** Which slots a layout actually draws; `hidden` is offered everywhere. */
export function slotsFor(kind: LayoutKind): PanelSlot[] {
  return kind === 'studio'
    ? ['left', 'right', 'bottom', 'bar', 'float', 'hidden']
    : ['bottom', 'bar', 'draw', 'float', 'hidden'];
}

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
  { id: 'layers', kind: 'widget', label: 'Слои' },
  { id: 'audio', kind: 'widget', label: 'Звук' },
  { id: 'export', kind: 'action', label: 'Экспорт' },
  { id: 'saved', kind: 'widget', wide: true, label: 'Отметка о сохранении' },
  { id: 'copy', kind: 'action', label: 'Копировать' },
  { id: 'paste', kind: 'action', label: 'Вставить' },
  { id: 'merge', kind: 'action', label: 'Объединить' },
  { id: 'settings', kind: 'action', label: 'Настройки', keep: true },
  { id: 'publish', kind: 'action', label: 'Опубликовать' },
];

export type PanelLayout = Record<PanelSlot, string[]>;
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
  layers: 'layers',
};

/**
 * The studio arrangement (toonio.ru): tools down the left, colour and brush on
 * the right, the strip over a transport row. Anything left out is hidden — the
 * layers popup, because the studio strip carries the rows itself.
 */
const STUDIO: Partial<PanelLayout> = {
  left: [...TOOL_ORDER.map(toolItem), 'save', 'pick-source', 'history', 'manual', 'fullscreen', 'drafts'],
  right: ['palette', 'brush'],
  bottom: ['timeline'],
  bar: [
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
  ],
};

/** One bar under the canvas (Multator): frames, transport, drawing. */
const BAR: Partial<PanelLayout> = {
  bottom: ['history', 'add-frame', 'delete-frame', 'timeline'],
  bar: [
    'transport',
    'onion',
    'fps',
    'zoom',
    'layers',
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
  draw: [...TOOL_ORDER.map(toolItem), 'pick-source', 'brush', 'palette'],
};

function emptyLayout(): PanelLayout {
  return { left: [], right: [], bottom: [], bar: [], draw: [], float: [], hidden: [] };
}

/** The arrangement a layout starts from; every item it does not place is hidden. */
export function defaultPanels(layout: LayoutKind): PanelLayout {
  const base = layout === 'bar' ? BAR : STUDIO;
  const next = emptyLayout();
  for (const slot of PANEL_SLOTS) {
    next[slot] = [...(base[slot] ?? [])];
  }
  const placed = new Set(PANEL_SLOTS.flatMap((slot) => next[slot]));
  next.hidden = PANEL_ITEMS.filter((item) => !placed.has(item.id)).map((item) => item.id);
  return next;
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
  for (const slot of PANEL_SLOTS) {
    const list = Array.isArray(stored[slot]) ? stored[slot] as unknown[] : [];
    for (const id of list) {
      if (typeof id === 'string' && panelItem(id) && !seen.has(id)) {
        seen.add(id);
        next[slot].push(id);
      }
    }
  }
  // A stored layout that put an item away which may not be put away (the
  // gear) is read as "not placed": it comes back with its layout default.
  next.hidden = next.hidden.filter((id) => {
    if (!panelItem(id)?.keep) {
      return true;
    }
    seen.delete(id);
    return false;
  });
  const fallback = defaultPanels(layout);
  for (const slot of PANEL_SLOTS) {
    for (const id of fallback[slot]) {
      if (!seen.has(id)) {
        seen.add(id);
        next[slot].push(id);
      }
    }
  }
  return next;
}

/** The same layout with `id` at `index` of `slot` (the end, when no index is given). */
export function movePanelItem(layout: PanelLayout, id: string, slot: PanelSlot, index?: number): PanelLayout {
  const item = panelItem(id);
  if (!item || (slot === 'hidden' && item.keep)) {
    return layout;
  }
  const next = emptyLayout();
  for (const key of PANEL_SLOTS) {
    next[key] = layout[key].filter((other) => other !== id);
  }
  const at = index ?? next[slot].length;
  next[slot].splice(Math.max(0, Math.min(next[slot].length, at)), 0, id);
  return next;
}

/** Back into the slot the layout default gives it. */
export function showPanelItem(layout: PanelLayout, id: string, kind: LayoutKind): PanelLayout {
  const home = defaultPanels(kind);
  const slot = PANEL_SLOTS.find((s) => s !== 'hidden' && home[s].includes(id)) ?? 'bar';
  return movePanelItem(layout, id, slot);
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
