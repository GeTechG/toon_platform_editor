/**
 * Canvas viewport: zoom and pan of the drawing surface. Pure math over CSS
 * pixels, so `bun test` covers it and CanvasView stays a thin caller.
 *
 * The canvas element keeps the size the page layout gives it; zoom magnifies
 * the document inside that element and pan slides it, so only the visible
 * region is ever rasterized (a 2 GB phone cannot hold a 10× buffer).
 */

/** Reference zoom range and wheel step (toonio: 1–10, 0.5 per notch). */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 10;
export const ZOOM_STEP = 0.5;

export interface Viewport2D {
  zoom: number;
  /** Offset of the document's top-left corner from the canvas corner, CSS px. */
  panX: number;
  panY: number;
}

export const IDENTITY_VIEW: Viewport2D = { zoom: 1, panX: 0, panY: 0 };

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return ZOOM_MIN;
  }
  const snapped = Math.round(value / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, snapped));
}

/**
 * Zooms to `zoom` around the canvas point (x, y) in CSS pixels, keeping the
 * document point under it in place, then clamps the pan.
 */
export function zoomAt(
  view: Viewport2D,
  zoom: number,
  x: number,
  y: number,
  width: number,
  height: number,
): Viewport2D {
  const next = clampZoom(zoom);
  const ratio = next / view.zoom;
  return clampPan(
    {
      zoom: next,
      panX: x - (x - view.panX) * ratio,
      panY: y - (y - view.panY) * ratio,
    },
    width,
    height,
  );
}

/**
 * Zooms to `zoom` and slides the document point under (x, y) to the middle of
 * the viewport — the reference's `NormalizeCoords`, which recentres on the
 * cursor instead of pinning the point in place the way `zoomAt` does.
 */
export function zoomCentredOn(
  view: Viewport2D,
  zoom: number,
  x: number,
  y: number,
  width: number,
  height: number,
): Viewport2D {
  const next = clampZoom(zoom);
  // Where the point sits along the document, 0..1, whatever the current view.
  const u = (x - view.panX) / (width * view.zoom);
  const v = (y - view.panY) / (height * view.zoom);
  return clampPan(
    {
      zoom: next,
      panX: width / 2 - u * width * next,
      panY: height / 2 - v * height * next,
    },
    width,
    height,
  );
}

/** Keeps the zoomed content covering the viewport — no empty margins. */
export function clampPan(view: Viewport2D, width: number, height: number): Viewport2D {
  return {
    zoom: view.zoom,
    panX: Math.min(0, Math.max(width - width * view.zoom, view.panX)),
    panY: Math.min(0, Math.max(height - height * view.zoom, view.panY)),
  };
}

/** Canvas point in CSS pixels → document units (fixed-point, unrounded). */
export function toDocument(
  x: number,
  y: number,
  size: { width: number; height: number },
  doc: { width: number; height: number },
  view: Viewport2D,
): [number, number] {
  return [
    ((x - view.panX) / (size.width * view.zoom)) * doc.width,
    ((y - view.panY) / (size.height * view.zoom)) * doc.height,
  ];
}
