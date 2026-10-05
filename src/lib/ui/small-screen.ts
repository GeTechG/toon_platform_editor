/**
 * Small screens: which layout step the studio takes, and what the tabs hold.
 *
 * The step is a sum, not a media query: how much the canvas would keep if the
 * columns and the bottom bar stayed, against `min(360px, 45vw)` ×
 * `max(320px, 38dvh)`. A
 * width query saw neither the columns (in rem, twice as wide at 200 % text)
 * nor the height, and a portrait tablet never counted as small at all.
 * Pure, so `bun test` runs it; Editor.svelte measures and draws.
 */

import { allPlaced, panelItem, toolOfItem, toolSpec, type PanelLayout } from './panels';

export type LayoutStep = 'full' | 'tablet' | 'phone';

export interface Room {
  w: number;
  h: number;
}

/** Past the floor by this much before a step goes back up: no flicker at the edge. */
export const HYSTERESIS = 32;
/** The tablet's canvas beside its column: a phone's column would eat the phone. */
export const TABLET_MIN_W = 360;
/**
 * The least canvas height the columns and the bar may leave, px. A phone
 * lying down (740×360, 844×390) kept 209–239 px of it beside the desktop's
 * columns — a 351×209 canvas and fold tabs 15 px wide — where the compact step
 * gives it the whole screen, some 300 px tall (the owner, after the
 * thirteenth audit). A share of the height alone never saw that: 38 % of a
 * short screen is short too. A laptop keeps twice this.
 */
export const FULL_MIN_H = 320;

/**
 * The narrowest screen the full layout is drawn on, px. The canvas's floor is
 * a share of the width, and an arrangement with one column (toonop: the brush
 * and the colours are keys on the top bar) cleared it on a phone standing up.
 */
export const FULL_MIN_W = 600;

/** The least canvas the full layout may leave: what `pickStep` asks of `rooms.full`. */
export function canvasFloor(view: Room): Room {
  return { w: Math.min(360, 0.45 * view.w), h: Math.max(FULL_MIN_H, 0.38 * view.h) };
}

/**
 * A size the hand stretched — the bar's height, a column's width — as drawn:
 * no more than `room`, what the canvas's floor leaves it, and never under its
 * own `floor`. Drawn, never stored: a bigger screen has the stretch whole
 * again. The step is picked from the floors alone, so a stretch (or a box
 * dropped into a row) cannot take a desktop to the phone's layout — where
 * there is no divider to drag back (owner, 21st audit).
 */
export function yieldToCanvas(stored: number, floor: number, room: number): number {
  return Math.max(floor, Math.min(stored, room));
}

/**
 * A bottom row that is tall because a box lies in it (the palette, the
 * brush), not because its keys wrapped: its height is the arrangement's
 * doing, not the screen's, and stays out of the floor the step is picked by.
 */
export function boxRow(row: readonly string[]): boolean {
  return row.includes('palette') || row.includes('brush');
}

function fits(room: Room, minW: number, minH: number, view: Room, slack: number): boolean {
  return room.w >= minW + slack && room.h >= Math.max(minH, 0.38 * view.h) + slack;
}

/**
 * The widest step that leaves the canvas its floor; the tablet step only on a
 * screen standing up. `rooms` is what the canvas
 * would keep in each: `full` with the columns and the bar, `tablet` beside the
 * tool column above the dock. A step above `current` needs the hysteresis too.
 */
export function pickStep(current: LayoutStep, rooms: { full: Room; tablet: Room }, view: Room): LayoutStep {
  const rank = { full: 0, tablet: 1, phone: 2 };
  const slack = (step: LayoutStep) => (rank[step] < rank[current] ? HYSTERESIS : 0);
  const floor = canvasFloor(view);
  if (view.w >= FULL_MIN_W && fits(rooms.full, floor.w, floor.h, view, slack('full'))) {
    return 'full';
  }
  // The in-between step is the portrait tablet's (the owner's call): lying
  // down, a column of tools costs the width a one-key strip leaves alone.
  if (view.h >= view.w && fits(rooms.tablet, TABLET_MIN_W, 0, view, slack('tablet'))) {
    return 'tablet';
  }
  return 'phone';
}

export type TabId = 'color' | 'brush' | 'timeline' | 'sound' | 'more';

export const DEFAULT_TAB_ORDER: readonly TabId[] = ['color', 'brush', 'timeline', 'sound', 'more'];

const BRUSH_ITEMS: readonly string[] = ['brush', 'brush-sizes', 'brush-key', 'brush-rail'];

/** What each named tab takes from the layout; «⋯» takes whatever is left. */
const TAB_ITEMS: Record<Exclude<TabId, 'more'>, readonly string[]> = {
  color: ['palette', 'color', 'color-key'],
  brush: BRUSH_ITEMS,
  // The «слой × кадр» strip and what the desktop keeps beside it to set the
  // frames and the playback. Not the transport: the mini transport does that.
  timeline: ['fps', 'add-frame', 'delete-frame', 'onion', 'copy', 'paste', 'merge', 'timeline'],
  sound: ['audio'],
};

/** A stored order, cleaned: unknown ids and repeats out, missing ones back at the end. */
export function normalizeTabOrder(value: unknown): TabId[] {
  const out: TabId[] = [];
  for (const stored of Array.isArray(value) ? value : []) {
    // «Слои» became «Таймлайн» and keeps its place.
    const id = stored === 'layers' ? 'timeline' : stored;
    if (DEFAULT_TAB_ORDER.includes(id) && !out.includes(id)) {
      out.push(id);
    }
  }
  return [...out, ...DEFAULT_TAB_ORDER.filter((id) => !out.includes(id))];
}

/** The order with `id` moved to `index` (counted in the order without it). */
export function moveTab(order: readonly TabId[], id: TabId, index: number): TabId[] {
  const rest = order.filter((other) => other !== id);
  rest.splice(Math.max(0, Math.min(rest.length, index)), 0, id);
  return rest;
}

/**
 * What a phone's column keeps of a preset's tools (the owner: «оставим только
 * важные»): its first drawing tool, the eraser, the lasso — and the pipette
 * only where the preset draws it as a tool key (Multator's reference three);
 * elsewhere it sits by the palette and a held finger does its work.
 */
export function phoneTools(ux: { tools: readonly string[]; pipetteOffRail: boolean }): string[] {
  const primary = ux.tools.find((tool) => toolSpec(tool)?.stroke) ?? 'pencil';
  return [primary, 'eraser', 'lasso', ...(ux.pipetteOffRail ? [] : ['pipette'])];
}

/** A phone's cut: the essential tools, and the one in hand wherever it came from. */
export interface PhoneKeep {
  tools: readonly string[];
  active: string;
}

export interface CompactLayout {
  /** The desktop's left column: one key wide on a phone, as wide as it is on a tablet. */
  rail: string[];
  /** The foot of that column: «Отправить мульт», wherever the layout put it. */
  foot: string[];
  /** The tabs that have something in them, in the user's order. */
  tabs: { id: TabId; items: string[] }[];
}

/**
 * The user's layout, cut for a small screen. The column is the desktop's left
 * column in its own order, then the tools and the history placed elsewhere;
 * a phone's column is one key wide, so a wide widget (the history aside)
 * goes to its tab. Publishing is pinned to the column's foot (the owner's
 * call). Everything else placed — the rows, the right column, the floating
 * windows (their places stay stored for the big screen) — goes to the tabs;
 * the shelf does not, and the transport's work is done by the mini transport.
 */
export function compactLayout(
  layout: PanelLayout,
  step: Exclude<LayoutStep, 'full'>,
  order: readonly TabId[],
  keep?: PhoneKeep,
): CompactLayout {
  // The spring is room in a line, and a small screen has no such line.
  const laid = allPlaced({ ...layout, hidden: [] }).filter((id) => id !== 'spring');
  // Where the brush is behind its tool's key (panels.ts `toolOpensBrush`) no
  // brush control is placed at all, and «Кисть» would be a tab of nothing: a
  // small screen has the one window, not a box under a key.
  const placed = BRUSH_ITEMS.some((id) => laid.includes(id)) ? laid : [...laid, 'brush-key'];
  const fits = (id: string) => step === 'tablet' || id === 'history' || !panelItem(id)?.wide;
  // The transport is the mini transport's, wherever the desktop put it.
  const own = layout.left.filter((id) => id !== 'publish' && id !== 'transport' && fits(id));
  const column = [...own, ...placed.filter((id) => !own.includes(id) && (toolOfItem(id) !== null || id === 'history'))];
  // A phone keeps the essentials; the rest goes to «⋯», and the tool in hand
  // shows in the column as well while it is in hand.
  const essential = (id: string, tools: readonly string[]) => {
    const tool = toolOfItem(id);
    return tool === null ? id === 'history' : tools.includes(tool);
  };
  const base = step === 'phone' && keep ? column.filter((id) => essential(id, keep.tools)) : column;
  const rail = step === 'phone' && keep ? column.filter((id) => essential(id, [...keep.tools, keep.active])) : column;
  const foot: string[] = placed.filter((id) => id === 'publish');
  const rest = placed.filter((id) => !base.includes(id) && !foot.includes(id) && id !== 'transport');
  const named = Object.values(TAB_ITEMS).flat();
  const tabs = order.map((id) => ({
    id,
    items: id === 'more'
      ? rest.filter((item) => !named.includes(item))
      : TAB_ITEMS[id].filter((item) => rest.includes(item)),
  }));
  return { rail, foot, tabs: tabs.filter((tab) => tab.items.length > 0) };
}

/**
 * Whether a small screen draws the column: something in it, or «Отправить
 * мульт» at its foot where the host publishes. The step asks the same, so the
 * tablet's room is the room the column really leaves.
 */
export function railDrawn(cut: CompactLayout, publishes: boolean): boolean {
  return cut.rail.length > 0 || (publishes && cut.foot.length > 0);
}

/**
 * Whether every tab's word fits on one line across its tab. All or none (the
 * owner's call): one word too wide and every tab shows only its icon.
 */
export function tabLabelsFit(labels: readonly { scrollWidth: number; clientWidth: number }[]): boolean {
  return labels.every((label) => label.scrollWidth <= label.clientWidth);
}

/**
 * Whether a sheet scrolls as one instead of pinning its head and foot. The
 * two take some 8.4 rem; a sheet is at most 85 % of the height, so under
 * 20 rem of height the pinned chrome would outgrow the body it frames — at
 * 200 % text on a phone lying down the body was a 35 px slit.
 */
export function sheetScrollsWhole(viewHeight: number, rootFont: number): boolean {
  return viewHeight > 0 && viewHeight < 20 * rootFont;
}
