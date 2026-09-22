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
 * document point under it in place, then clamps the pan.
 */
export function zoomAt(view: Viewport2D, zoom: number, x: number, y: number, stage: Stage): Viewport2D {
  const next = clampZoom(zoom);
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
 * Halved while a navigation gesture is on, and never below 1: pan and pinch
 * bake into the buffers, so every frame of the gesture rebuilds the stack, and
 * a quarter of the pixels is what reads as smooth exactly while the picture
 * moves. A screen at density 1 keeps its pixels — it has none to spare, and
 * a desktop with a mouse has no problem to solve.
 */
export function renderDensity(deviceDpr: number, navigating = false): number {
  const density = Number.isFinite(deviceDpr) && deviceDpr > 0 ? Math.min(2, deviceDpr) : 1;
  return navigating ? Math.max(1, density / 2) : density;
}
