/**
 * Tonio's pixel tool (tools.js `Pixel`): points are grid cells of the tool's
 * width, not a smoothed line. Faithful port, quirks included — the capture
 * dedup scans only the points the line already had, so a repeat inside one
 * pointer batch survives, and `Prepare` thins by the tool width without the
 * duplicated endpoint the pencil adds.
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

/**
 * Appends the snapped cells of one pointer batch. Returns a new array; cells
 * already present in `line` before this call are dropped.
 */
export function appendPixelCells(
  line: readonly number[],
  points: readonly number[],
  width: number,
): number[] {
  const result = line.slice();
  if (points.length % 2 !== 0) {
    return result;
  }
  const known = line.length;
  for (let i = 0; i < points.length; i += 2) {
    const x = pixelCell(points[i], width);
    const y = pixelCell(points[i + 1], width);
    let exists = false;
    for (let k = 0; k < known; k += 2) {
      if (line[k] === x && line[k + 1] === y) {
        exists = true;
        break;
      }
    }
    if (!exists) {
      result.push(x, y);
    }
  }
  return result;
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

/**
 * Commit-time thinning (reference `Pixel.Prepare`): drops a cell closer than
 * the tool width to the previous kept one, `>=` rejects, and the true endpoint
 * is appended once — no sentinel.
 */
export function pixelPrepare(points: readonly number[], width: number): number[] {
  if (points.length <= 2) {
    return points.slice();
  }
  const result = [points[0], points[1]];
  for (let i = 2; i < points.length - 2; i += 2) {
    const distance = Math.hypot(points[i - 2] - points[i], points[i - 1] - points[i + 1]);
    if (distance >= width) {
      result.push(points[i], points[i + 1]);
    }
  }
  result.push(points[points.length - 2], points[points.length - 1]);
  return result;
}
