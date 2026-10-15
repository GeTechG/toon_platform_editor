/**
 * Canvas viewport: zoom and pan of the drawing surface. Pure math over CSS
 * pixels, so `bun test` covers it and CanvasView stays a thin caller.
 *
 * The sheet lies on a worktable the size of the stage: the canvas element is
 * the whole workspace, and the view says where the sheet sits on it and how
 * big it is drawn. The frame is a bitmap of the sheet (`sheetRaster`) and the
 * view stretches it, so the sheet can be walked around and magnified without
 * a buffer of the magnified size.
 */

import { FIXED_POINT_SCALE } from '../format/constants';

/** Zoom range: a tenth of the sheet up to the reference's 10× (toonio: 1–10). */
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 10;
/** The reference's notch for the keys and the zoom buttons, kept from 100% up. */
export const ZOOM_STEP = 0.5;
/** Below 100% the sheet is small — a 0.5 notch would jump past it. */
const FINE_STEP = 0.1;
/** How much of the sheet stays on the workspace when it is pushed off, CSS px. */
export const EDGE_KEEP = 64;
/** Air left around the sheet at 100%, so the whole page is on the table. */
export const FIT_PADDING = 16;

export interface Viewport2D {
  zoom: number;
  /** Offset of the sheet's top-left corner from the workspace corner, CSS px. */
  panX: number;
  panY: number;
  /**
   * How far the sheet is turned about that corner, degrees clockwise on the
   * screen, within half a turn either way. The drawing is not turned — only
   * the paper under the hand, as on a desk.
   */
  angle: number;
}

/** The workspace and the sheet lying on it, both in CSS pixels. */
export interface Stage {
  /** Canvas element — the whole worktable. */
  width: number;
  height: number;
  /** The sheet at zoom 1: the document fitted inside the workspace. */
  sheetWidth: number;
  sheetHeight: number;
  /**
   * Where the fit laid the sheet at 100 %, when something stands over the
   * stage (`fitSheet`'s covers); the middle of the workspace without it.
   */
  sheetX?: number;
  sheetY?: number;
  /** Where a panel lying across the foot of the table begins (`footOf`); the table's own height without one. */
  foot?: number;
}

/** What stands over the stage for good — the thickness rail, the zoom window — in workspace px. */
export interface Cover {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Takes nothing off the sheet: the sheet only steps aside from it, where the stage has room (the zoom window). */
  shy?: boolean;
  /** Stands along a side whatever its place (the finger's thickness rail): the sheet is fitted beside it, never above or below. */
  side?: boolean;
}

/**
 * A cover by what of it stands over the workspace. One that runs past an
 * edge (the bar under the canvas runs on under the columns) had a negative
 * gap there, was taken to stand on that edge alone, and was fitted around
 * not at all.
 */
export function clipCover(cover: Cover, width: number, height: number): Cover {
  const x = Math.max(0, cover.x);
  const y = Math.max(0, cover.y);
  return {
    ...cover,
    x,
    y,
    width: Math.max(0, Math.min(width, cover.x + cover.width) - x),
    height: Math.max(0, Math.min(height, cover.y + cover.height) - y),
  };
}

export const IDENTITY_VIEW: Viewport2D = { zoom: 1, panX: 0, panY: 0, angle: 0 };

/** A vector turned by `angle` degrees, clockwise on the screen. */
function spin(x: number, y: number, angle: number): [number, number] {
  // The right angles exactly: a sheet stood on its side must not lie a
  // millionth of a pixel off the grid.
  const q = ((angle % 360) + 360) % 360;
  const cos = q === 90 || q === 270 ? 0 : q === 180 ? -1 : Math.cos((q * Math.PI) / 180);
  const sin = q === 0 || q === 180 ? 0 : q === 90 ? 1 : q === 270 ? -1 : Math.sin((q * Math.PI) / 180);
  return [x * cos - y * sin, x * sin + y * cos];
}

/** An angle brought within half a turn either way: (−180, 180]. */
export function wrapAngle(angle: number): number {
  if (!Number.isFinite(angle)) {
    return 0;
  }
  const a = ((angle % 360) + 360) % 360;
  return a > 180 ? a - 360 : a;
}

/** The magnets a free turn sticks to — every eighth of a turn — and how near it must come, degrees. The calibration knobs. */
export const TURN_MAGNET = 45;
export const TURN_PULL = 4;
/** One press of the turn keys. */
export const TURN_STEP = 15;
/** How far two fingers twist before the sheet turns at all: a pinch is never quite straight. The calibration knob. */
export const TWIST_SLOP = 10;

/** A turn by hand, stuck to the nearest magnet it has come close to. */
export function snapAngle(angle: number): number {
  const near = Math.round(angle / TURN_MAGNET) * TURN_MAGNET;
  return wrapAngle(Math.abs(angle - near) <= TURN_PULL ? near : angle);
}

/**
 * The angle one press of a turn key leads to: the next notch of fifteen
 * degrees in that direction, so a sheet left at 37° by the fingers goes to 45°
 * or 30°, not to 52°.
 */
export function turnStep(angle: number, direction: number): number {
  const eps = 1e-6;
  return wrapAngle(
    direction > 0
      ? Math.floor(angle / TURN_STEP + eps) * TURN_STEP + TURN_STEP
      : Math.ceil(angle / TURN_STEP - eps) * TURN_STEP - TURN_STEP,
  );
}

/** The box a turned sheet stands in on the table, CSS px. */
function sheetBox(view: Viewport2D, stage: Stage): { x: number; y: number; width: number; height: number } {
  const w = stage.sheetWidth * view.zoom;
  const h = stage.sheetHeight * view.zoom;
  const [ax, ay] = spin(w, 0, view.angle);
  const [bx, by] = spin(0, h, view.angle);
  const x = Math.min(0, ax, bx, ax + bx);
  const y = Math.min(0, ay, by, ay + by);
  return {
    x: view.panX + x,
    y: view.panY + y,
    width: Math.max(0, ax, bx, ax + bx) - x,
    height: Math.max(0, ay, by, ay + by) - y,
  };
}

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  const step = value < 1 ? FINE_STEP : ZOOM_STEP;
  const snapped = Math.round((Math.round(value / step) * step) * 100) / 100;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, snapped));
}

/**
 * One notch of the `+`/`-` keys or the zoom buttons: the way to the
 * next notch of the ladder (0.1 below 100%, 0.5 above) in that direction. A
 * pinch leaves the zoom between notches, and a flat step from there skipped
 * one — out of 104% landed on 50%.
 */
export function zoomDelta(zoom: number, direction: number): number {
  // A hair of slack, so a zoom that is a notch but for float noise counts as it.
  const eps = 1e-6;
  const up = direction > 0;
  const fine = up ? zoom < 1 - eps : zoom <= 1 + eps;
  const step = fine ? FINE_STEP : ZOOM_STEP;
  const next = up
    ? Math.floor(zoom / step + eps) * step + step
    : Math.ceil(zoom / step - eps) * step - step;
  // Rounded to the hundredth the snap keeps; every caller snaps what it adds up.
  return Math.round((next - zoom) * 100) / 100;
}

/** Ctrl and plus or minus: finer notches than the reference's half (owner, 2026-10-15). */
const FINE_LADDER = [
  0.1, 0.125, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9,
  1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10,
];

/** The next notch of the finer ladder from `zoom` in that direction; the end of the range stays. */
export function zoomNotch(zoom: number, direction: number): number {
  const eps = 1e-6;
  return direction > 0
    ? FINE_LADDER.find((z) => z > zoom + eps) ?? ZOOM_MAX
    : [...FINE_LADDER].reverse().find((z) => z < zoom - eps) ?? ZOOM_MIN;
}

/**
 * The smallest pixel step a mouse notch comes in (Chrome 100, 120 and
 * up; Firefox 3 lines). A trackpad scrolls a few px at a time.
 * ponytail: a heuristic — a Mac mouse with fine steps pans; the calibration knob.
 */
export const WHEEL_MOUSE_PX = 50;

/**
 * Two fingers on a trackpad, not a mouse wheel (owner, after the fifteenth
 * audit: a trackpad scroll moves the sheet, as in Procreate and Photoshop).
 * Lines and pages are a wheel; a sideways part or small pixel steps are a
 * trackpad; `streak` — a trackpad scroll a moment ago — keeps the big deltas
 * of a fling's tail in the same pan.
 */
export function trackpadScroll(
  e: { deltaX: number; deltaY: number; deltaMode: number },
  streak: boolean,
): boolean {
  if (e.deltaMode !== 0) return false;
  return streak || e.deltaX !== 0 || Math.abs(e.deltaY) < WHEEL_MOUSE_PX;
}

/**
 * Ctrl+wheel zoom per px of travel. A Mac trackpad pinch arrives as Ctrl+wheel
 * a few px at a time and wants a smooth zoom, not notches; a mouse notch
 * (100 px) comes out as ×1.65. The calibration knob.
 */
export const WHEEL_ZOOM_RATE = 0.005;

/**
 * The plain wheel's zoom per px of travel: a mouse notch is a tenth of the
 * zoom, seven of them double the sheet (owner, 2026-10-11: a softer zoom than
 * the reference's 0.5 notch). The calibration knob.
 */
export const WHEEL_SOFT_RATE = 0.001;

/** The zoom after one wheel event: continuous, a big delta capped at one notch. */
export function ctrlWheelZoom(zoom: number, deltaY: number, deltaMode: number, rate = WHEEL_ZOOM_RATE): number {
  const travel = deltaMode === 0 ? Math.max(-100, Math.min(100, deltaY)) : Math.sign(deltaY) * 100;
  return zoom * Math.exp(-travel * rate);
}

/** How fast the wheel's zoom glides to its goal: the time it takes to cover 63% of the way, ms. The calibration knob. */
export const ZOOM_GLIDE_MS = 45;

/**
 * The zoom one frame later on its way to `goal` (the plain wheel): an even
 * share of the ratio left per ms, so a 120 Hz screen and a 60 Hz one glide
 * alike, landing on the goal once the eye cannot tell them apart.
 */
export function easeZoom(zoom: number, goal: number, dtMs: number): number {
  const left = Math.log(goal / zoom) * Math.exp(-Math.max(0, dtMs) / ZOOM_GLIDE_MS);
  return Math.abs(left) < 0.002 ? goal : goal / Math.exp(left);
}

/**
 * A cover counts as standing on every edge it is this close to, past the
 * nearest one: a window in a corner can give up its row or its column.
 */
const COVER_EDGE_SLACK = 16;

type Cut = 'left' | 'right' | 'top' | 'bottom' | null;

/**
 * The sheet at 100%: the document fitted inside the workspace with air around
 * it, so the whole page — edges, shadow and all — is on screen from the start.
 * An unmeasured height (Infinity) fits by width alone.
 *
 * `covers` stand over the stage for good (the thickness rail, the zoom
 * window), and the page is fitted clear of them, as Procreate Dreams fits it
 * beside its sidebar: each cover takes its strip off an edge it stands on —
 * or nothing, when the sheet does not reach it — and the biggest sheet wins,
 * then the one nearest the middle. Only the fit: zoom and pan stay free.
 */
export function fitSheet(
  width: number,
  height: number,
  doc: { width: number; height: number },
  covers: readonly Cover[] = [],
): { width: number; height: number; x: number; y: number } {
  const over = covers.filter(
    (c) => c.width > 0 && c.height > 0 && c.x < width && c.x + c.width > 0 && c.y < height && c.y + c.height > 0,
  );
  const on = over.filter((c) => !c.shy);
  const cuts = on.map((c): Cut[] => {
    // The rail starts near the top of a low stage, and by the nearest edge it
    // was the head's: the sheet went under its foot, a strip 50 px tall on an
    // iPhone SE (owner, 2026-10-13). The stage's height here runs on under the
    // bottom panel, so «more than half of it» did not catch the rail either.
    if (c.side) return [null, c.x + c.width / 2 < width / 2 ? 'left' : 'right'];
    const gaps: [Cut, number][] = [
      ['left', c.x],
      ['right', width - c.x - c.width],
      ['top', c.y],
      ['bottom', height - c.y - c.height],
    ];
    const near = Math.min(...gaps.map(([, gap]) => gap));
    // …and one lying across more than half the stage is the foot's or the
    // head's as well: by the nearest edge alone a widget 10 px from either
    // side was a side's, and left no room at all.
    const across: Cut[] = c.width > width / 2 ? ['top', 'bottom'] : c.height > height / 2 ? ['left', 'right'] : [];
    return [null, ...new Set([...gaps.filter(([, gap]) => gap <= near + COVER_EDGE_SLACK).map(([cut]) => cut), ...across])];
  });
  let best: { width: number; height: number; x: number; y: number } | null = null;
  let bestBox = { l: 0, t: 0, r: width, b: height };
  let bestOff = Infinity;
  const pick = (index: number, box: { l: number; t: number; r: number; b: number }, free: Cover[]): void => {
    if (index < on.length) {
      const c = on[index];
      for (const cut of cuts[index]) {
        pick(
          index + 1,
          {
            l: cut === 'left' ? Math.max(box.l, c.x + c.width) : box.l,
            r: cut === 'right' ? Math.min(box.r, c.x) : box.r,
            t: cut === 'top' ? Math.max(box.t, c.y + c.height) : box.t,
            b: cut === 'bottom' ? Math.min(box.b, c.y) : box.b,
          },
          cut === null ? [...free, c] : free,
        );
      }
      return;
    }
    const room = box.r - box.l - 2 * FIT_PADDING;
    const tall = box.b - box.t - 2 * FIT_PADDING;
    if (on.length > 0 && (room <= 0 || tall <= 0)) return;
    const scale = Math.min(Math.max(1, room) / doc.width, Math.max(1, tall) / doc.height);
    const w = doc.width * scale;
    const h = doc.height * scale;
    // In the middle of its box — the room the covers leave — not of the
    // workspace: that runs on under the bar, and by its middle the sheet sat
    // low on a screen standing up (owner, 2026-10-07).
    const x = (box.l + box.r - w) / 2;
    const y = Number.isFinite(height) ? (box.t + box.b - h) / 2 : 0;
    const place = { width: w, height: h, x, y };
    if (free.some((c) => c.x < x + w && x < c.x + c.width && c.y < y + h && y < c.y + c.height)) return;
    // Of sheets of one size, first the one that stands clear of the most
    // covers by a strip of its own — the middle of the room they leave, even
    // where the sheet would not reach them — then the one nearest the middle.
    const off =
      free.length * 1e6 + Math.abs(x + w / 2 - width / 2) + (Number.isFinite(height) ? Math.abs(y + h / 2 - height / 2) : 0);
    if (!best || w > best.width + 1e-9 || (w > best.width - 1e-9 && off < bestOff - 1e-9)) {
      best = place;
      bestBox = box;
      bestOff = off;
    }
  };
  pick(0, { l: 0, t: 0, r: width, b: height }, []);
  // Covers that leave no room at all are not fitted around: the sheet is the product.
  const laid: { width: number; height: number; x: number; y: number } = best ?? fitSheet(width, height, doc);
  // A shy cover (the zoom window) takes nothing off the sheet (owner,
  // 2026-10-07): the sheet, its size kept, steps aside by the shortest way
  // the stage has room for — half the air between them — or stays under it.
  for (const c of over.filter((cover) => cover.shy)) {
    if (!(c.x < laid.x + laid.width && laid.x < c.x + c.width && c.y < laid.y + laid.height && laid.y < c.y + c.height)) continue;
    const air = FIT_PADDING / 2;
    const ways = [
      { dx: c.x + c.width + air - laid.x, dy: 0 },
      { dx: c.x - air - laid.width - laid.x, dy: 0 },
      ...(Number.isFinite(height)
        ? [
            { dx: 0, dy: c.y + c.height + air - laid.y },
            { dx: 0, dy: c.y - air - laid.height - laid.y },
          ]
        : []),
    ].filter(
      ({ dx, dy }) =>
        laid.x + dx >= bestBox.l + FIT_PADDING - 1e-9 &&
        laid.x + dx + laid.width <= bestBox.r - FIT_PADDING + 1e-9 &&
        laid.y + dy >= bestBox.t + FIT_PADDING - 1e-9 &&
        (dy === 0 || laid.y + dy + laid.height <= bestBox.b - FIT_PADDING + 1e-9),
    );
    if (ways.length === 0) continue;
    const way = ways.reduce((a, b) => (Math.abs(b.dx) + Math.abs(b.dy) < Math.abs(a.dx) + Math.abs(a.dy) ? b : a));
    laid.x += way.dx;
    laid.y += way.dy;
  }
  return laid;
}

/** Where the sheet at 100% lies: the fit's place, or the middle of the workspace. */
function fittedAt(stage: Stage): { x: number; y: number } {
  return {
    x: stage.sheetX ?? (stage.width - stage.sheetWidth) / 2,
    y: stage.sheetY ?? (stage.height - stage.sheetHeight) / 2,
  };
}

/** 100%, with the sheet where the fit laid it (centred, when nothing covers the stage). */
export function fitView(stage: Stage): Viewport2D {
  const at = fittedAt(stage);
  return { zoom: 1, panX: at.x, panY: at.y, angle: 0 };
}

/**
 * Zooms to `zoom` around the workspace point (x, y) in CSS pixels, keeping the
 * document point under it in place, then clamps the pan. A pinch passes
 * `snap = false`: fingers move continuously, and the notches made it leap.
 */
export function zoomAt(
  view: Viewport2D,
  zoom: number,
  x: number,
  y: number,
  stage: Stage,
  snap = true,
): Viewport2D {
  const next = snap
    ? clampZoom(zoom)
    : Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(zoom) ? zoom : view.zoom));
  const ratio = next / view.zoom;
  return clampPan(
    {
      ...view,
      zoom: next,
      panX: x - (x - view.panX) * ratio,
      panY: y - (y - view.panY) * ratio,
    },
    stage,
  );
}

/**
 * Turns the sheet to `angle` about the workspace point (x, y), keeping the
 * document point under it in place, then clamps the pan.
 */
export function rotateAt(view: Viewport2D, angle: number, x: number, y: number, stage: Stage): Viewport2D {
  const next = wrapAngle(angle);
  const [dx, dy] = spin(view.panX - x, view.panY - y, next - view.angle);
  return clampPan({ zoom: view.zoom, panX: x + dx, panY: y + dy, angle: next }, stage);
}

/**
 * The view carried over to a workspace of another size — a phone turned, a
 * panel dragged. The sheet at 100% is refitted to the new workspace, so the
 * old pan in CSS px pointed somewhere else: an untouched sheet ran off the
 * edge. The point of the sheet in the middle of the screen stays there.
 */
export function resizedView(view: Viewport2D, from: Stage, to: Stage): Viewport2D {
  // The middle is the fitted sheet's: with a cover over the stage, the middle
  // of what is left of it — so a sheet nobody moved stays fitted.
  const a = anchorOf(from);
  const b = anchorOf(to);
  const [sx, sy] = spin(a.x - view.panX, a.y - view.panY, -view.angle);
  const u = sx / (from.sheetWidth * view.zoom);
  const v = sy / (from.sheetHeight * view.zoom);
  const [dx, dy] = spin(u * to.sheetWidth * view.zoom, v * to.sheetHeight * view.zoom, view.angle);
  return clampPan(
    {
      ...view,
      panX: b.x - dx,
      panY: b.y - dy,
    },
    to,
  );
}

function anchorOf(stage: Stage): { x: number; y: number } {
  const at = fittedAt(stage);
  return { x: at.x + stage.sheetWidth / 2, y: at.y + stage.sheetHeight / 2 };
}

/** Keeps the sheet on the table: it slides freely, an edge always in reach. */
export function clampPan(view: Viewport2D, stage: Stage): Viewport2D {
  // A turned sheet is kept by the box it stands in: one of its corners is
  // always on that box's edge, so an edge of the box in reach is the sheet's.
  const box = sheetBox(view, stage);
  return {
    ...view,
    panX: view.panX - box.x + panAxis(box.x, stage.width, box.width),
    // The table runs on under the bottom panel: kept by its whole height, the
    // sheet's last 64 px lay behind the panel, out of sight.
    panY: view.panY - box.y + panAxis(box.y, stage.foot ?? stage.height, box.height),
  };
}

/**
 * The top of what lies across the foot of the table — a cover wider than
 * half of it that reaches its bottom edge (the timeline) — or the table's
 * height. The shy zoom window and a window in a corner are not a foot.
 */
export function footOf(covers: readonly Cover[], width: number, height: number): number {
  return Math.min(
    height,
    ...covers
      .filter((c) => !c.shy && c.width > width / 2 && height - c.y - c.height <= COVER_EDGE_SLACK)
      .map((c) => c.y),
  );
}

/** A key press moves the sheet this share of the table — ten presses cross it. */
export const KEY_PAN_SHARE = 0.1;

/**
 * Ctrl+Shift+arrow: the magnified sheet slid by a tenth of the table, within
 * the same bounds as a pan by the mouse (`clampPan`). The arrow says where to
 * look, so the sheet goes the other way. A sheet at its fit or smaller lies
 * whole on the table — there is nothing to bring into view, and the view
 * stays as it is (the same object).
 */
export function keyPan(view: Viewport2D, stage: Stage, key: string): Viewport2D {
  if (view.zoom <= 1) {
    return view;
  }
  const dx = key === 'ArrowLeft' ? 1 : key === 'ArrowRight' ? -1 : 0;
  const dy = key === 'ArrowUp' ? 1 : key === 'ArrowDown' ? -1 : 0;
  if (dx === 0 && dy === 0) {
    return view;
  }
  return clampPan(
    {
      ...view,
      panX: view.panX + dx * Math.round(stage.width * KEY_PAN_SHARE),
      panY: view.panY + dy * Math.round(stage.height * KEY_PAN_SHARE),
    },
    stage,
  );
}

function panAxis(pan: number, workspace: number, sheet: number): number {
  // The sheet lies loose on the table at every zoom — a small one is pushed
  // around as freely as a magnified one; only losing it is forbidden.
  const keep = Math.min(sheet, EDGE_KEEP);
  return Math.min(workspace - keep, Math.max(keep - sheet, pan));
}

/**
 * Workspace point in CSS pixels → document units (fixed-point, unrounded).
 * `sheet` is the sheet at zoom 1; a point beside the sheet reads as units
 * outside the document, which is what the table around it is.
 */
export function toDocument(
  x: number,
  y: number,
  sheet: { width: number; height: number },
  doc: { width: number; height: number },
  view: Viewport2D,
): [number, number] {
  const [sx, sy] = spin(x - view.panX, y - view.panY, -view.angle);
  return [
    (sx / (sheet.width * view.zoom)) * doc.width,
    (sy / (sheet.height * view.zoom)) * doc.height,
  ];
}

/** Document units → the workspace point in CSS pixels they are drawn at: `toDocument` back. */
export function toWorkspace(
  x: number,
  y: number,
  sheet: { width: number; height: number },
  doc: { width: number; height: number },
  view: Viewport2D,
): [number, number] {
  const [dx, dy] = spin(
    (x / doc.width) * sheet.width * view.zoom,
    (y / doc.height) * sheet.height * view.zoom,
    view.angle,
  );
  return [view.panX + dx, view.panY + dy];
}

/**
 * Device pixels per CSS pixel the editor rasterizes at.
 *
 * Capped at two. The editor keeps about ten full-stage buffers — the three of
 * the layer stack, the live layer, the composite, a layer scratch, the paper
 * and the onion ghosts — and each of them is the whole worktable. At the
 * density 3 a phone reports, their backing store together runs past a hundred
 * megabytes on a device that is not given that much, and the end of it is not
 * a lag but a reloaded tab. On line art the difference between 2× and 3× is
 * not there to see.
 *
 * A navigation gesture does not change it: pan and pinch move the last
 * composed picture (`reprojection`) instead of rebuilding it, so there is
 * nothing to save by drawing fewer pixels while the hand moves — and nothing
 * to resize twice when it starts and stops.
 */
export function renderDensity(deviceDpr: number): number {
  return Number.isFinite(deviceDpr) && deviceDpr > 0 ? Math.min(2, deviceDpr) : 1;
}

/** A view as the canvas drew it: zoom, pan in CSS px and the turn, and the density. */
export interface DrawnView extends Viewport2D {
  dpr: number;
}

/**
 * Whether a picture of the whole table drawn under `drawn` still holds all of
 * the sheet the view `now` has on the table. A shot is the table as it was:
 * at 300 % a third of the sheet is on it, and the part a pan or a pinch out
 * brings in was bare paper until the hand let go. A pixel of slack, so a
 * fraction of one does not count as uncovered.
 */
export function shotCovers(drawn: DrawnView, now: DrawnView, stage: Stage): boolean {
  // Turned since, the shot's table lies askew on this one: the corners of the
  // sheet it brings in were never on it.
  if (now.angle !== drawn.angle) {
    return false;
  }
  const k = now.zoom / drawn.zoom;
  // A turned sheet by the box it stands in — more than the sheet, never less.
  const box = sheetBox(now, stage);
  const axis = (was: number, pan: number, table: number, lo: number, size: number): boolean => {
    // The sheet on the table now, and where the shot's table lands.
    const from = Math.max(0, lo);
    const to = Math.min(table, lo + size);
    const shotFrom = pan - k * was;
    return to <= from || (shotFrom <= from + 1 && shotFrom + k * table >= to - 1);
  };
  return axis(drawn.panX, now.panX, stage.width, box.x, box.width)
    && axis(drawn.panY, now.panY, stage.height, box.y, box.height);
}

/**
 * Where a picture drawn under `from` lands under `to`: the uniform scale, the
 * turn in degrees about the picture's own corner, and the offset, in `to`'s
 * device pixels, that put every point of it back where the new view would
 * draw it. Pan and pinch show the last composed frame through
 * this and rebuild it once, when the hand lets go.
 */
export function reprojection(
  from: DrawnView,
  to: DrawnView,
): { scale: number; x: number; y: number; turn: number } {
  const k = to.zoom / from.zoom;
  const turn = wrapAngle(to.angle - from.angle);
  const [px, py] = spin(from.panX, from.panY, turn);
  return {
    scale: (k * to.dpr) / from.dpr,
    x: to.dpr * (to.panX - k * px),
    y: to.dpr * (to.panY - k * py),
    turn,
  };
}

/**
 * The longest side of the sheet's bitmap, pixels: 1080p, lying or standing.
 * Past it a frame costs too much to rasterize on any device (owner,
 * 2026-10-10) — 76 ms for five layers of a hundred lines without a GPU.
 */
export const SHEET_LONG_MAX = 1920;

/** The sheet's bitmap a frame is composed into. */
export interface SheetRaster {
  /** Bitmap pixels per logical pixel of the document: 1, or ½, ⅓… of a larger sheet. */
  level: number;
  width: number;
  height: number;
}

/**
 * The bitmap the frame is rasterized into: the whole sheet, a pixel per
 * logical pixel of the document — the same on every screen and at any zoom,
 * and never drawn finer: a sheet magnified past it shows its pixels. A sheet
 * longer than 1080p takes a whole fraction of itself, so its lines stay on the
 * pixel grid.
 */
export function sheetRaster(doc: { width: number; height: number }): SheetRaster {
  const n = Math.max(1, Math.ceil(Math.max(doc.width, doc.height) / FIXED_POINT_SCALE / SHEET_LONG_MAX));
  return {
    level: 1 / n,
    width: Math.max(1, Math.round(doc.width / FIXED_POINT_SCALE / n)),
    height: Math.max(1, Math.round(doc.height / FIXED_POINT_SCALE / n)),
  };
}
