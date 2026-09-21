/**
 * The grid a stamped mark lands on: what the renderer and the transform need
 * to draw and move a run of cells.
 *
 * The tool that *makes* them lives in the shipped plugin, along with its
 * capture and its thinning — nothing here knows a tool at all. A stamp is a
 * primitive of the format, so the player must be able to draw one without a
 * line of plugin code anywhere near it.
 */

/**
 * Snaps one coordinate onto the cell grid: the reference's `w * ~~(v / w)`.
 * `| 0` and not `Math.trunc`, so a value inside the first negative cell gives
 * 0 rather than -0 — coordinates are int16, well inside int32.
 */
export function pixelCell(value: number, width: number): number {
  return width * ((value / width) | 0);
}

/**
 * Snaps one coordinate onto the closest cell of the grid. Capture uses
 * `pixelCell` (the reference's truncation), but a transform lands a whole row
 * between cells with one shared remainder: truncating sends neighbours
 * opposite ways and collapses them, while rounding moves every cell of the
 * row by the same step — the shape survives and lands back on the grid, so
 * drawing over it afterwards lines up.
 */
export function pixelCellNearest(value: number, width: number): number {
  return width * Math.round(value / width) || 0;
}

/** Bresenham over cells, `step` units per pixel (reference `InterpolateLine`). */
export function interpolatePixelLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  step: number,
): number[] {
  const pixels: number[] = [];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dx1 = Math.abs(dx);
  const dy1 = Math.abs(dy);
  let px = 2 * dy1 - dx1;
  let py = 2 * dx1 - dy1;
  let x: number;
  let y: number;
  if (dy1 <= dx1) {
    let xe: number;
    if (dx >= 0) {
      x = x0;
      y = y0;
      xe = x1;
    } else {
      x = x1;
      y = y1;
      xe = x0;
    }
    pixels.push(x, y);
    while (x < xe) {
      x += step;
      if (px < 0) {
        px += 2 * dy1 * step;
      } else {
        y += (dx < 0 && dy < 0) || (dx > 0 && dy > 0) ? step : -step;
        px += 2 * (dy1 - dx1) * step;
      }
      pixels.push(x, y);
    }
    return pixels;
  }
  let ye: number;
  if (dy >= 0) {
    x = x0;
    y = y0;
    ye = y1;
  } else {
    x = x1;
    y = y1;
    ye = y0;
  }
  pixels.push(x, y);
  while (y < ye) {
    y += step;
    if (py <= 0) {
      py += 2 * dx1 * step;
    } else {
      x += (dx < 0 && dy < 0) || (dx > 0 && dy > 0) ? step : -step;
      py += 2 * (dx1 - dy1) * step;
    }
    pixels.push(x, y);
  }
  return pixels;
}
