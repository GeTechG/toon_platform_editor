/**
 * Small screens: which layout step the studio takes, and what a phone draws.
 *
 * The step is a sum, not a media query: how much the canvas would keep if the
 * columns and the bottom bar stayed, against `min(360px, 45vw)` ×
 * `max(320px, 38dvh)`. A
 * width query saw neither the columns (in rem, twice as wide at 200 % text)
 * nor the height, and a portrait tablet never counted as small at all.
 * Pure, so `bun test` runs it; Editor.svelte measures and draws.
 */

import { allPlaced, toolOfItem, toolSpec, type PanelLayout } from './panels';
import { FIT_PADDING } from './viewport';

export type LayoutStep = 'full' | 'phone';

export interface Room {
  w: number;
  h: number;
}

/** Past the floor by this much before a step goes back up: no flicker at the edge. */
export const HYSTERESIS = 32;
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

/** The most layers the bar grows for by itself; the rest scroll. */
const LAYERS_SHOWN = 4;

/**
 * The bar's height while no hand has dragged its divider: its floor shows one
 * layer, and every layer after it (up to four) gets its row — «+ Слой» on a
 * fresh studio slid the first layer half under the frame numbers.
 */
export function panelByLayers(floor: number, layers: number, row: number): number {
  return floor + (Math.min(Math.max(layers, 1), LAYERS_SHOWN) - 1) * row;
}

/**
 * A bottom row that is tall because a box lies in it (the palette, the
 * brush), not because its keys wrapped: its height is the arrangement's
 * doing, not the screen's, and stays out of the floor the step is picked by.
 */
export function boxRow(row: readonly string[]): boolean {
  return row.includes('palette') || row.includes('brush');
}

/**
 * The desktop where the canvas keeps its floor, the phone where it does not:
 * there is no step between (owner, 2026-10-07 — a tablet is the desktop).
 * `full` is what the canvas would keep beside the columns and the bar. Back up
 * to the desktop needs the hysteresis too.
 */
export function pickStep(current: LayoutStep, full: Room, view: Room): LayoutStep {
  const slack = current === 'phone' ? HYSTERESIS : 0;
  const floor = canvasFloor(view);
  return view.w >= FULL_MIN_W && full.w >= floor.w + slack && full.h >= floor.h + slack ? 'full' : 'phone';
}

/**
 * What a phone's row keeps of a preset's tools (the owner: «оставим только
 * важные»): its first drawing tool and the eraser — the transform is with
 * the other tools (owner, 2026-10-07) — and the pipette only where the preset
 * draws it as a tool key (Multator); elsewhere it sits by the palette and a
 * held finger does its work.
 */
export function phoneTools(ux: { tools: readonly string[]; pipetteOffRail: boolean }): string[] {
  const primary = ux.tools.find((tool) => toolSpec(tool)?.stroke) ?? 'pencil';
  return [primary, 'eraser', ...(ux.pipetteOffRail ? [] : ['pipette'])];
}

/** A phone's cut: what its row of keys is made from. */
export interface PhoneKeep {
  /** The essential tools: first into the row. */
  tools: readonly string[];
  /** Standing up. Lying down the sidebar has no height for undo and redo: the row takes them. */
  tall: boolean;
  /** How many tool keys the row has room for (`toolRoom`). */
  room: number;
  /** Whether the profile draws the tool's key at all: one it does not takes no room. */
  drawn: (tool: string) => boolean;
}

/** A key on the tap floor and the gap after it, px (`.studio.compact .top`). */
const keyPitch = (rem: number): number => 44 + 0.25 * rem;

/**
 * How many tool keys a phone's row has room for: the top bar scales with the
 * screen (owner, 2026-10-07) — what does not fit goes behind one key for the
 * other tools. `keys` is what else stands in the row beside «Отправить»: «⋯»,
 * the colour, undo and redo lying down. Never under two: a tool and that key.
 */
export function toolRoom(width: number, rem: number, row: { publish: boolean; keys: number }): number {
  const pitch = keyPitch(rem);
  const taken = rem + (row.publish ? 3.25 * rem + 0.25 * rem : 0) + row.keys * pitch;
  return Math.max(2, Math.floor((width - taken) / pitch));
}

/** What the phone's own keys already open: the colour key, a tool's key pressed again, the sidebar. */
const BEHIND_A_KEY: readonly string[] = ['palette', 'color', 'color-key', 'brush', 'brush-sizes', 'brush-key', 'brush-rail'];

/**
 * The frame keys a phone does not draw (owner, 2026-10-07: «убрать и сделать
 * напрямую на таймлайне жестами»): the strip's own menu, a held finger on a
 * cell, deletes, copies, pastes and merges.
 */
const ON_THE_STRIP: readonly string[] = ['delete-frame', 'copy', 'paste', 'merge'];

export type MoreGroup = 'frames' | 'toon' | 'studio';

/**
 * The order inside «⋯»'s named groups: the window's own, not the
 * arrangement's — a hand-made arrangement came out as a pile, live keys and
 * dead ones mixed (owner, 2026-10-07). What is in neither list is the
 * studio's, in the order it was placed.
 */
const MORE_ORDER: Record<'frames' | 'toon', readonly string[]> = {
  frames: ['fps'],
  toon: ['save', 'export', 'drafts', 'saved'],
};

export interface PhoneLayout {
  /** What the studio draws: the desktop's markup, given this arrangement. */
  panels: PanelLayout;
  /** Behind «⋯»: everything else the user's arrangement draws, by group; no group is empty. */
  more: { id: MoreGroup; items: string[] }[];
  /** Behind the key for the other tools: those the row had no room for. */
  tools: string[];
}

/**
 * A phone's arrangement (owner, 2026-10-07: «как у procreate, по сути это
 * нынешний десктоп»): `base` — toonop's desktop — with its bar over the canvas
 * cut to one row: «Отправить», «⋯», then as many tools as the row has room
 * for — the essential ones first — a key for the rest of them, and the colour.
 * The sound's key stands by the transport: the track is the strip's. Whatever
 * else the user's own arrangement draws is behind «⋯»; what it keeps on the
 * shelf stays there.
 */
export function phoneLayout(layout: PanelLayout, base: PanelLayout, keep: PhoneKeep): PhoneLayout {
  const placed = allPlaced({ ...layout, hidden: [] });
  const tools = placed.filter((id) => keep.drawn(toolOfItem(id) ?? '') && toolOfItem(id) !== null);
  const essential = (id: string) => keep.tools.includes(toolOfItem(id) ?? '');
  const ranked = [...tools.filter(essential), ...tools.filter((id) => !essential(id))];
  // All of them, or the essential ones and a key for the rest: a row that
  // took «whatever came next» showed a different third tool at every width.
  // Lying down the row holds the transport too: the other tools are behind their key whatever the width.
  const inRow = keep.tall && ranked.length <= keep.room ? ranked : ranked.filter(essential).slice(0, keep.room - 1);
  const rest = ranked.slice(inRow.length);
  const lying = keep.tall ? [] : ['history'];
  // By the transport, at the far end: the onion skin and the sound are the strip's.
  const far = ['onion', 'audio'].filter((id) => placed.includes(id));
  const sound = far.length > 0 ? ['spring', ...far] : [];
  // The frame rate's slider took the transport's line on 390 px: behind «⋯».
  const rows = base.rows.map((row) => (row.includes('transport') ? [...row.filter((id) => id !== 'fps'), ...sound] : row));
  // Lying down the height is the canvas's (owner, 2026-10-07): the transport's
  // keys stand in the row over it, which has the width, and the bar is the
  // strip alone — folded, only its fold key.
  // In the middle of the row, a spring on either side (owner: «сделай их по центру»).
  const lifted = keep.tall ? [] : ['spring:lead', ...rows.filter((row) => row.includes('transport')).flat().filter((id) => id !== 'spring')];
  const panels: PanelLayout = {
    left: base.left.filter((id) => !lying.includes(id)),
    right: [],
    top: [...placed.filter((id) => id === 'publish'), 'more', ...lying, ...lifted, 'spring', ...inRow, ...(rest.length > 0 ? ['tools'] : []), 'color-key'],
    rows: keep.tall ? rows : rows.filter((row) => !row.includes('transport')),
    float: [],
    hidden: [],
  };
  // Off the panels, as toonop keeps them: a tool's key opens the brush only where no brush control is placed.
  panels.hidden = BEHIND_A_KEY.filter((id) => !panels.top.includes(id) && !panels.left.includes(id));
  const drawn = [...base.left, ...rows.flat(), 'publish', 'spring', 'audio', 'onion', ...BEHIND_A_KEY, ...ON_THE_STRIP];
  // The frame rate is always there: the row it stood in has no room for it.
  const behind = [...placed.filter((id) => !drawn.includes(id) && toolOfItem(id) === null && id !== 'fps'), 'fps'];
  return { panels, more: moreGroups(behind), tools: rest };
}

/** «⋯»'s named groups, in the window's own order; no group is empty. */
function moreGroups(behind: readonly string[]): PhoneLayout['more'] {
  const listed = Object.values(MORE_ORDER).flat();
  const groups: PhoneLayout['more'] = [
    { id: 'frames', items: MORE_ORDER.frames.filter((id) => behind.includes(id)) },
    { id: 'toon', items: MORE_ORDER.toon.filter((id) => behind.includes(id)) },
    { id: 'studio', items: behind.filter((id) => !listed.includes(id)) },
  ];
  return groups.filter((group) => group.items.length > 0);
}

/** How far the desktop's bar over the canvas is cut to stay one row: whole, the other tools behind their key, the rest behind «⋯» too. */
export type TopCut = 0 | 1 | 2;

/** What stays in the desktop's row at any cut: «Отправить», the room, the keys of the colour and the brush. */
const STAYS_IN_ROW: readonly string[] = ['publish', 'spring', ...BEHIND_A_KEY];

/**
 * The desktop's arrangement with its bar over the canvas cut to one row
 * (owner, 2026-10-07, an iPad Air standing up: the row wrapped, the colour
 * key alone on a second line) — as Procreate keeps one row, and as the phone
 * does: first the tools past the essential ones go behind one key, then what
 * is neither a tool nor `STAYS_IN_ROW` behind «⋯». Each key stands where the
 * first of what it hides stood; one key is not hidden behind another. The
 * columns and the bar under the canvas are the user's own. `null`: no cut.
 */
export function oneRowTop(layout: PanelLayout, cut: TopCut, keep: { tools: readonly string[] }): PhoneLayout | null {
  if (cut === 0) return null;
  const fold = (top: readonly string[], hide: (id: string) => boolean, key: string): { top: string[]; hidden: string[] } => {
    const hidden = top.filter(hide);
    if (hidden.length < 2) return { top: [...top], hidden: [] };
    return { top: top.flatMap((id) => (id === hidden[0] ? [key] : hide(id) ? [] : [id])), hidden };
  };
  const tools = fold(layout.top, (id) => toolOfItem(id) !== null && !keep.tools.includes(toolOfItem(id) ?? ''), 'tools');
  const rest = cut === 2 ? fold(tools.top, (id) => toolOfItem(id) === null && id !== 'tools' && !STAYS_IN_ROW.includes(id), 'more') : { top: tools.top, hidden: [] };
  return { panels: { ...layout, top: rest.top }, more: moreGroups(rest.hidden), tools: tools.hidden };
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

/**
 * Whether the thickness widget lies along the stage's foot or stands at its
 * side: by the sheet, not by the screen (owner, 2026-10-07: «пускай
 * адаптируется положение не по разрешению, а по типу холста, чтобы он
 * максимально место занимал») — whichever leaves the fitted sheet bigger.
 * `rail` is what the widget takes: its column standing, its line lying.
 * All the same to the sheet (nothing measured yet): by the screen, `tall`.
 */
export function railLiesFor(stage: Room, doc: { width: number; height: number }, rail: { side: number; foot: number }, tall: boolean): boolean {
  const fit = (w: number, h: number): number =>
    Math.min(Math.max(0, w - 2 * FIT_PADDING) / doc.width, Math.max(0, h - 2 * FIT_PADDING) / doc.height);
  const lying = fit(stage.w, stage.h - rail.foot);
  const standing = fit(stage.w - rail.side, stage.h);
  return Math.abs(lying - standing) < 1e-9 ? tall : lying > standing;
}
