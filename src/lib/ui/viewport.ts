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
 * One notch of the wheel, the `+`/`-` keys or the zoom buttons. The step is
 * picked for where the notch lands, so 100% is never a wall to climb.
 */
export function zoomDelta(zoom: number, direction: number): number {
  const fine = direction > 0 ? zoom < 1 : zoom <= 1;
  const step = fine ? FINE_STEP : ZOOM_STEP;
  return direction > 0 ? step : -step;
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
 * The sheet at 100%: the document fitted inside the workspace with air around
 * it, so the whole page — edges, shadow and all — is on screen from the start.
 * An unmeasured height (Infinity) fits by width alone.
 */
export function fitSheet(
  width: number,
  height: number,
  doc: { width: number; height: number },
): { width: number; height: number } {
  const room = Math.max(1, width - 2 * FIT_PADDING);
  const tall = Math.max(1, height - 2 * FIT_PADDING);
  const scale = Math.min(room / doc.width, tall / doc.height);
  return { width: doc.width * scale, height: doc.height * scale };
}

/** 100% with the sheet centred on the workspace. */
export function fitView(stage: Stage): Viewport2D {
  return {
    zoom: 1,
    panX: (stage.width - stage.sheetWidth) / 2,
    panY: (stage.height - stage.sheetHeight) / 2,
  };
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

/** Keeps the sheet on the table: it slides freely, an edge always in reach. */
export function clampPan(view: Viewport2D, stage: Stage): Viewport2D {
  return {
    zoom: view.zoom,
    panX: panAxis(view.panX, stage.width, stage.sheetWidth * view.zoom),
    panY: panAxis(view.panY, stage.height, stage.sheetHeight * view.zoom),
  };
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
