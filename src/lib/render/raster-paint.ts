import { readRasterAsset } from '../draft/raster-store';
import { FIXED_POINT_SCALE } from '../format/constants';
import { hashRasterBytes } from '../format/project';
import { rasterSheetSize } from '../format/studio-document';
import type { RasterCel, ToonDocument } from '../format/types';
import { pressureOf, sameRasterCel, type ResolvedStroke } from '../model/operations';
import { renderStrokesLayer, type Canvas2DLike } from './canvas2d';
import { encodeRasterPixels } from './raster-encode';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function strokeBounds(sheet: Pick<Rect, 'width' | 'height'>, stroke: ResolvedStroke): Rect {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (let i = 0; i < stroke.points.length; i += 2) {
    const x = stroke.points[i] / FIXED_POINT_SCALE;
    const y = stroke.points[i + 1] / FIXED_POINT_SCALE;
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  const reach = ('width' in stroke.tool ? stroke.tool.width : 0) / FIXED_POINT_SCALE + 3;
  const x = Math.min(sheet.width, Math.max(0, Math.floor(left - reach)));
  const y = Math.min(sheet.height, Math.max(0, Math.floor(top - reach)));
  return {
    x, y,
    width: Math.max(0, Math.min(sheet.width, Math.ceil(right + reach)) - x),
    height: Math.max(0, Math.min(sheet.height, Math.ceil(bottom + reach)) - y),
  };
}

function alphaBounds(data: ImageData): Rect | undefined {
  const { width, height } = data;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data.data[(y * width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = y;
    }
  }
  if (right < 0) return undefined;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export type RasterPaint = { changed: false } | { changed: true; cel?: RasterCel; blob?: Blob };

export async function paintRasterStroke(
  doc: Pick<ToonDocument, 'width' | 'height'>,
  previous: RasterCel | undefined,
  stroke: ResolvedStroke,
): Promise<RasterPaint> {
  const area = strokeBounds(rasterSheetSize(doc), stroke);
  if (!area.width || !area.height) return { changed: false };
  if (stroke.tool.kind === 'eraser') {
    if (!previous || previous.x + previous.width <= area.x || previous.y + previous.height <= area.y ||
        area.x + area.width <= previous.x || area.y + area.height <= previous.y) return { changed: false };
    Object.assign(area, { x: previous.x, y: previous.y, width: previous.width, height: previous.height });
  } else if (previous) {
    const right = Math.max(area.x + area.width, previous.x + previous.width);
    const bottom = Math.max(area.y + area.height, previous.y + previous.height);
    area.x = Math.min(area.x, previous.x);
    area.y = Math.min(area.y, previous.y);
    area.width = right - area.x;
    area.height = bottom - area.y;
  }

  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(area.width, area.height)
    : Object.assign(document.createElement('canvas'), { width: area.width, height: area.height });
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('Canvas is unavailable');
    if (previous) {
      const blob = await readRasterAsset(previous.hash);
      if (!blob) throw new Error('Raster drawing is unavailable');
      const image = await createImageBitmap(blob);
      try {
        ctx.drawImage(image, previous.x - area.x, previous.y - area.y);
      } finally {
        image.close();
      }
    }
    renderStrokesLayer({ strokes: [{ points: stroke.points, tool_id: 0, ...pressureOf(stroke) }] },
      [stroke.tool], ctx as unknown as Canvas2DLike,
      { scale: 1 / FIXED_POINT_SCALE, dpr: 1, panX: -area.x, panY: -area.y });
    const pixels = ctx.getImageData(0, 0, area.width, area.height);
    const crop = alphaBounds(pixels);
    if (!crop) return { changed: previous !== undefined };
    const cropped = crop.width === area.width && crop.height === area.height ? pixels
      : ctx.getImageData(crop.x, crop.y, crop.width, crop.height);
    canvas.width = 0;
    canvas.height = 0;
    const bytes = await encodeRasterPixels(cropped);
    const hash = await hashRasterBytes(bytes.buffer);
    const cel = { hash, x: area.x + crop.x, y: area.y + crop.y, width: crop.width, height: crop.height };
    if (sameRasterCel(cel, previous)) return { changed: false };
    return { changed: true, cel, blob: new Blob([bytes], { type: 'image/webp' }) };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
