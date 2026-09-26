/**
 * Small screens: which layout step the studio takes, and what the tabs hold.
 *
 * The step is a sum, not a media query: how much the canvas would keep if the
 * columns and the bottom bar stayed, against `min(360px, 45vw)` × `38dvh`. A
 * width query saw neither the columns (in rem, twice as wide at 200 % text)
 * nor the height, and a portrait tablet never counted as small at all.
 * Pure, so `bun test` runs it; Editor.svelte measures and draws.
 */

import { allPlaced, toolOfItem, type PanelLayout } from './panels';

export type LayoutStep = 'full' | 'tablet' | 'phone';

export interface Room {
  w: number;
  h: number;
}

/** Past the floor by this much before a step goes back up: no flicker at the edge. */
export const HYSTERESIS = 32;
/** The tablet's canvas beside its column: a phone's column would eat the phone. */
const TABLET_MIN_W = 360;

function fits(room: Room, minW: number, view: Room, slack: number): boolean {
  return room.w >= minW + slack && room.h >= 0.38 * view.h + slack;
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
  if (fits(rooms.full, Math.min(360, 0.45 * view.w), view, slack('full'))) {
    return 'full';
  }
  // The in-between step is the portrait tablet's (the owner's call): lying
  // down, a column of tools costs the width a one-key strip leaves alone.
  if (view.h >= view.w && fits(rooms.tablet, TABLET_MIN_W, view, slack('tablet'))) {
    return 'tablet';
  }
  return 'phone';
}

export type TabId = 'color' | 'brush' | 'layers' | 'sound' | 'more';

export const DEFAULT_TAB_ORDER: readonly TabId[] = ['color', 'brush', 'layers', 'sound', 'more'];

/** What each named tab takes from the layout; «⋯» takes whatever is left. */
const TAB_ITEMS: Record<Exclude<TabId, 'more'>, readonly string[]> = {
  color: ['palette', 'color'],
  brush: ['brush', 'brush-sizes'],
  // The strip is the layers: the «слой × кадр» grid with the names beside it.
  layers: ['timeline'],
  sound: ['audio'],
};

/** A stored order, cleaned: unknown ids and repeats out, missing ones back at the end. */
export function normalizeTabOrder(value: unknown): TabId[] {
  const out: TabId[] = [];
  for (const id of Array.isArray(value) ? value : []) {
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

export interface CompactLayout {
  /** The phone's one-key strip, or the tablet's column. */
  rail: string[];
  /** The tabs that have something in them, in the user's order. */
  tabs: { id: TabId; items: string[] }[];
}

/**
 * The user's layout, cut for a small screen. Everything placed — the columns,
 * the rows, the floating windows (their places stay stored for the big
 * screen) — goes somewhere; the shelf does not. The transport's work is done
 * by the mini transport, so it goes nowhere.
 */
export function compactLayout(layout: PanelLayout, step: Exclude<LayoutStep, 'full'>, order: readonly TabId[]): CompactLayout {
  const placed = allPlaced({ ...layout, hidden: [] });
  const tools = placed.filter((id) => toolOfItem(id) !== null);
  const rail = step === 'tablet'
    ? [...layout.left, ...tools.filter((id) => !layout.left.includes(id))]
    : [...tools, ...placed.filter((id) => id === 'history')];
  const rest = placed.filter((id) => !rail.includes(id) && id !== 'transport');
  const named = Object.values(TAB_ITEMS).flat();
  const tabs = order.map((id) => ({
    id,
    items: id === 'more' ? rest.filter((item) => !named.includes(item)) : rest.filter((item) => TAB_ITEMS[id].includes(item)),
  }));
  return { rail, tabs: tabs.filter((tab) => tab.items.length > 0) };
}
