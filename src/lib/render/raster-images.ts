import { readRasterAsset } from '../draft/raster-store';
import { FIXED_POINT_SCALE } from '../format/constants';
import type { RasterCel, ToonDocument } from '../format/types';
import { resolveCell } from '../model/cells';
import type { Viewport } from './contract';
import type { Canvas2DFrameRenderer, Canvas2DLike } from './canvas2d';

const DECODED_BUDGET = 64 * 1024 * 1024;
const COMPRESSED_BUDGET = 32 * 1024 * 1024;

class RasterCache<T> {
  readonly #entries = new Map<string, { value: T; bytes: number }>();
  #bytes = 0;

  constructor(readonly budget: number, readonly dispose?: (value: T) => void) {}

  get(key: string): T | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }

  add(key: string, value: T, bytes: number): void {
    if (bytes > this.budget) {
      this.dispose?.(value);
      return;
    }
    const existing = this.#entries.get(key);
    if (existing) {
      this.#entries.delete(key);
      this.#bytes -= existing.bytes;
      if (existing.value !== value) this.dispose?.(existing.value);
    }
    while (this.#bytes + bytes > this.budget) {
      const oldest = this.#entries.keys().next().value!;
      const before = this.#entries.get(oldest)!;
      this.#entries.delete(oldest);
      this.#bytes -= before.bytes;
      this.dispose?.(before.value);
    }
    this.#entries.set(key, { value, bytes });
    this.#bytes += bytes;
  }
}

const compressed = new RasterCache<Blob>(COMPRESSED_BUDGET);
const decoded = new RasterCache<ImageBitmap>(DECODED_BUDGET, (image) => image.close());

type RasterRequest = { key: string; cel: RasterCel; width: number; height: number };
type LoadOptions = { priority?: number; signal?: AbortSignal };
type DecodeJob = {
  request: RasterRequest;
  consumers: LoadOptions[];
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
};
const jobs = new Map<string, DecodeJob>();
let decoding = false;

async function rasterBlob(hash: string): Promise<Blob> {
  const cached = compressed.get(hash);
  if (cached) return cached;
  const blob = await readRasterAsset(hash);
  if (!blob) throw new Error('Raster drawing is unavailable');
  compressed.add(hash, blob, blob.size);
  return blob;
}

async function decode({ cel, width, height }: Omit<RasterRequest, 'key'>, read = rasterBlob): Promise<ImageBitmap> {
  const blob = await read(cel.hash);
  if (width === cel.width && height === cel.height) return createImageBitmap(blob);
  try {
    const resized = await createImageBitmap(blob, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
    if (resized.width === width && resized.height === height) return resized;
    resized.close();
  } catch {
    // The options may be unsupported on browsers that decode a plain WebP.
  }
  const image = await createImageBitmap(blob);
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height });
  try {
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('Canvas is unavailable');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, width, height);
    return await createImageBitmap(canvas);
  } finally {
    image.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

function decodePriority(job: DecodeJob): number {
  return job.consumers.reduce((best, { priority = 0, signal }) =>
    signal?.aborted ? best : Math.max(best, priority), -1);
}

async function drainDecodes(): Promise<void> {
  while (jobs.size) {
    let next: DecodeJob | undefined;
    let priority = -1;
    for (const [key, job] of jobs) {
      const wanted = decodePriority(job);
      if (wanted < 0) {
        jobs.delete(key);
        job.resolve();
      } else if (wanted > priority) {
        next = job;
        priority = wanted;
      }
    }
    if (!next) break;
    const { key, width, height } = next.request;
    try {
      if (!decoded.get(key)) {
        const bitmap = await decode(next.request);
        if (decodePriority(next) < 0) {
          bitmap.close();
        } else if (bitmap.width !== width || bitmap.height !== height) {
          bitmap.close();
          throw new Error('Unexpected raster image size');
        } else {
          decoded.add(key, bitmap, width * height * 4);
        }
      }
      next.resolve();
    } catch (err) {
      next.reject(err);
    } finally {
      jobs.delete(key);
    }
  }
  decoding = false;
}

function load(request: RasterRequest, options: LoadOptions): Promise<void> {
  const existing = jobs.get(request.key);
  if (existing) {
    existing.consumers.push(options);
    return existing.promise;
  }
  let finish!: () => void;
  let fail!: (reason: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  jobs.set(request.key, { request, consumers: [options], promise, resolve: finish, reject: fail });
  if (!decoding) {
    decoding = true;
    queueMicrotask(() => void drainDecodes());
  }
  return promise;
}

function displayScale(viewport: Viewport): number {
  return Math.min(1, viewport.scale * viewport.dpr * FIXED_POINT_SCALE);
}

function imageSize(cel: RasterCel, scale: number): Pick<RasterRequest, 'width' | 'height'> {
  return {
    width: Math.max(1, Math.floor(cel.width * scale)),
    height: Math.max(1, Math.floor(cel.height * scale)),
  };
}

export function visibleRasterCells(doc: ToonDocument, frame: number, layers?: readonly number[]): RasterCel[] {
  const result: RasterCel[] = [];
  for (const [index, layer] of doc.layers.entries()) {
    if (layer.kind !== 'raster' || layer.hidden || layer.opacity === 0 || (layers && !layers.includes(index))) continue;
    const cel = resolveCell(layer, frame).raster;
    if (cel) result.push(cel);
  }
  return result;
}

export function rasterImages(cells: readonly RasterCel[], viewport: Viewport, sampleScale = displayScale(viewport)): {
  viewport: Viewport;
  key: string;
  ready: boolean;
  load: (options?: LoadOptions) => Promise<void>;
} {
  if (!cells.length) return { viewport, key: '', ready: true, load: () => Promise.resolve() };
  const unique = new Map(cells.map((cel) => [cel.hash, cel]));
  let pixels = 0;
  for (const cel of unique.values()) pixels += cel.width * cel.height;
  const scale = Math.min(sampleScale, Math.sqrt(DECODED_BUDGET / (pixels * 4)));
  const requests = new Map<string, RasterRequest>();
  for (const cel of unique.values()) {
    const { width, height } = imageSize(cel, scale);
    requests.set(cel.hash, { key: `${cel.hash}:${width}x${height}`, cel, width, height });
  }
  const pending = [...requests.values()].filter(({ key }) => !decoded.get(key));
  return {
    key: [...requests.values()].map(({ key }) => key).join(','),
    viewport: {
      ...viewport,
      raster: (cel) => {
        const request = requests.get(cel.hash);
        return request && decoded.get(request.key);
      },
    },
    ready: pending.length === 0,
    load: async (options = {}) => {
      await Promise.all(pending.map((request) => load(request, options)));
    },
  };
}

export async function renderRasterFrame(
  renderer: Canvas2DFrameRenderer,
  doc: ToonDocument,
  frame: number,
  target: Canvas2DLike,
  viewport: Viewport,
  read?: (hash: string) => Promise<Blob>,
): Promise<void> {
  const cells = visibleRasterCells(doc, frame);
  const unique = new Map(cells.map((cel) => [cel.hash, cel]));
  const scale = displayScale(viewport);
  let bytes = 0;
  for (const cel of unique.values()) {
    const { width, height } = imageSize(cel, scale);
    bytes += width * height * 4;
  }
  if (read || bytes > DECODED_BUDGET) {
    await renderer.renderWithRaster(doc, frame, target, viewport, (cel) => decode({ cel, ...imageSize(cel, scale) }, read));
    return;
  }
  const images = rasterImages(cells, viewport);
  if (!images.ready) await images.load({ priority: 1 });
  if (cells.some((cel) => !images.viewport.raster?.(cel))) {
    await renderer.renderWithRaster(doc, frame, target, viewport, (cel) => decode({ cel, ...imageSize(cel, scale) }));
    return;
  }
  renderer.render(doc, frame, target, images.viewport);
}
