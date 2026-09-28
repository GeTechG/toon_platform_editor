/**
 * Canvas viewport: zoom and pan of the drawing surface. Pure math over CSS
 * pixels, so `bun test` covers it and CanvasView stays a thin caller.
 *
 * The sheet lies on a worktable the size of the stage: the canvas element is
 * the whole workspace, and the view says where the sheet sits on it and how
 * big it is drawn. Only the visible region is ever rasterized (a 2 GB phone
 * cannot hold a 10× buffer), so the sheet can be walked around, not just
 * magnified inside its own frame.
 */

/** Zoom range: a tenth of the sheet up to the reference's 10× (toonio: 1–10). */
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 10;
/** The reference's wheel notch, kept from 100% up. */
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
}

/** What stands over the stage for good — the thickness rail, the zoom window — in workspace px. */
export interface Cover {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const IDENTITY_VIEW: Viewport2D = { zoom: 1, panX: 0, panY: 0 };

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  const step = value < 1 ? FINE_STEP : ZOOM_STEP;
  const snapped = Math.round((Math.round(value / step) * step) * 100) / 100;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, snapped));
}

/**
 * One notch of the wheel, the `+`/`-` keys or the zoom buttons: the way to the
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

/**
 * Wheel travel that makes one zoom notch, CSS px. A mouse notch is 100 in
 * Chrome and about 50 in Firefox; a trackpad sends a few px per event, and
 * zooming a whole step per event threw the sheet to 1000% in one swipe.
 * The calibration knob, if a wheel on some system needs two turns.
 */
export const WHEEL_NOTCH_PX = 40;

/**
 * One wheel event → how many notches it completes (+1 zooms in, -1 out, at
 * most one per event) and the travel left over for the next one. A sideways
 * swipe carries no deltaY and zooms nothing.
 */
export function wheelNotch(rest: number, deltaY: number, deltaMode: number): { notch: number; rest: number } {
  // Lines and pages (deltaMode 1, 2) come one notch at a time.
  const travel = deltaMode === 0 ? deltaY : Math.sign(deltaY) * WHEEL_NOTCH_PX;
  // A turn of direction starts afresh rather than paying back the other way.
  const sum = Math.sign(rest) === -Math.sign(travel) ? travel : rest + travel;
  if (Math.abs(sum) < WHEEL_NOTCH_PX) {
    return { notch: 0, rest: sum };
  }
  return { notch: sum < 0 ? 1 : -1, rest: 0 };
}

/**
 * Ctrl+wheel zoom per px of travel. A Mac trackpad pinch arrives as Ctrl+wheel
 * a few px at a time and wants a smooth zoom, not notches; a mouse notch
 * (100 px) comes out as ×1.65. The calibration knob.
 */
export const WHEEL_ZOOM_RATE = 0.005;

/** The zoom after one Ctrl+wheel event: continuous, a big delta capped at one notch. */
export function ctrlWheelZoom(zoom: number, deltaY: number, deltaMode: number): number {
  const travel = deltaMode === 0 ? Math.max(-100, Math.min(100, deltaY)) : Math.sign(deltaY) * 100;
  return zoom * Math.exp(-travel * WHEEL_ZOOM_RATE);
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
  const on = covers.filter(
    (c) => c.width > 0 && c.height > 0 && c.x < width && c.x + c.width > 0 && c.y < height && c.y + c.height > 0,
  );
  const cuts = on.map((c): Cut[] => {
    const gaps: [Cut, number][] = [
      ['left', c.x],
      ['right', width - c.x - c.width],
      ['top', c.y],
      ['bottom', height - c.y - c.height],
    ];
    const near = Math.min(...gaps.map(([, gap]) => gap));
    return [null, ...gaps.filter(([, gap]) => gap <= near + COVER_EDGE_SLACK).map(([cut]) => cut)];
  });
  let best: { width: number; height: number; x: number; y: number } | null = null;
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
    // In the middle of the workspace, moved no further than into its box.
    const x = Math.min(box.r - FIT_PADDING - w, Math.max(box.l + FIT_PADDING, (width - w) / 2));
    const y = Number.isFinite(height)
      ? Math.min(box.b - FIT_PADDING - h, Math.max(box.t + FIT_PADDING, (height - h) / 2))
      : 0;
    const place = { width: w, height: h, x, y };
    if (free.some((c) => c.x < x + w && x < c.x + c.width && c.y < y + h && y < c.y + c.height)) return;
    const off = Math.abs(x + w / 2 - width / 2) + (Number.isFinite(height) ? Math.abs(y + h / 2 - height / 2) : 0);
    if (!best || w > best.width + 1e-9 || (w > best.width - 1e-9 && off < bestOff - 1e-9)) {
      best = place;
      bestOff = off;
    }
  };
  pick(0, { l: 0, t: 0, r: width, b: height }, []);
  // Covers that leave no room at all are not fitted around: the sheet is the product.
  return best ?? fitSheet(width, height, doc);
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
  return { zoom: 1, panX: at.x, panY: at.y };
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
      zoom: next,
      panX: x - (x - view.panX) * ratio,
      panY: y - (y - view.panY) * ratio,
    },
    stage,
  );
}

/**
 * Zooms to `zoom` and slides the document point under (x, y) to the middle of
 * the workspace — the reference's `NormalizeCoords`, which recentres on the
 * cursor instead of pinning the point in place the way `zoomAt` does.
 */
export function zoomCentredOn(
  view: Viewport2D,
  zoom: number,
  x: number,
  y: number,
  stage: Stage,
): Viewport2D {
  const next = clampZoom(zoom);
  // Where the point sits along the sheet, 0..1, whatever the current view.
  const u = (x - view.panX) / (stage.sheetWidth * view.zoom);
  const v = (y - view.panY) / (stage.sheetHeight * view.zoom);
  return clampPan(
    {
      zoom: next,
      panX: stage.width / 2 - u * stage.sheetWidth * next,
      panY: stage.height / 2 - v * stage.sheetHeight * next,
    },
    stage,
  );
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
  const u = (a.x - view.panX) / (from.sheetWidth * view.zoom);
  const v = (a.y - view.panY) / (from.sheetHeight * view.zoom);
  return clampPan(
    {
      zoom: view.zoom,
      panX: b.x - u * to.sheetWidth * view.zoom,
      panY: b.y - v * to.sheetHeight * view.zoom,
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
  return {
    zoom: view.zoom,
    panX: panAxis(view.panX, stage.width, stage.sheetWidth * view.zoom),
    panY: panAxis(view.panY, stage.height, stage.sheetHeight * view.zoom),
  };
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
      zoom: view.zoom,
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
  return [
    ((x - view.panX) / (sheet.width * view.zoom)) * doc.width,
    ((y - view.panY) / (sheet.height * view.zoom)) * doc.height,
  ];
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

/** A view as the canvas drew it: zoom and pan in CSS px, and the density. */
export interface DrawnView {
  zoom: number;
  panX: number;
  panY: number;
  dpr: number;
}

/**
 * The pixel of a picture drawn under `drawn` that lies under the workspace
 * point (x, y), CSS px, of the view on screen `now` — the inverse of
 * `reprojection`. The pipette reads the composed layers, and those are the
 * view's of the last frame drawn: right after a zoom, or all through a
 * pinch, the screen is already elsewhere.
 */
export function pickedPixel(x: number, y: number, now: DrawnView, drawn: DrawnView): [number, number] {
  const k = drawn.zoom / now.zoom;
  return [
    drawn.dpr * (drawn.panX + (x - now.panX) * k),
    drawn.dpr * (drawn.panY + (y - now.panY) * k),
  ];
}

/**
 * Where a picture drawn under `from` lands under `to`: the uniform scale and
 * offset, in `to`'s device pixels, that put every point of it back where the
 * new view would draw it. Pan and pinch show the last composed frame through
 * this and rebuild it once, when the hand lets go.
 */
export function reprojection(from: DrawnView, to: DrawnView): { scale: number; x: number; y: number } {
  const k = to.zoom / from.zoom;
  return {
    scale: (k * to.dpr) / from.dpr,
    x: to.dpr * (to.panX - k * from.panX),
    y: to.dpr * (to.panY - k * from.panY),
  };
}
