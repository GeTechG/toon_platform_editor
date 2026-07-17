/**
 * Gallery preview: render a document's first frames through the same
 * Canvas2DFrameRenderer the player uses (so the preview matches what a viewer
 * sees), downscaled and frame-capped, encode each frame to a WebP still with the
 * browser's native `canvas.toBlob('image/webp')`, and stitch the stills into one
 * looping animated WebP (see ./webp). DOM-bound, so it lives beside export-gif
 * and isn't unit-tested here — its pure pieces are (./webp.test.ts).
 */

import { FIXED_POINT_SCALE } from '../format/constants';
import type { ToonDocument } from '../format/types';
import { Canvas2DFrameRenderer } from '../render/canvas2d';
import type { Canvas2DLike } from '../render/canvas2d';
import { assembleAnimatedWebp, downscaleSize, previewFrameBudget, type WebpStill } from './webp';

/** Downscale target: the preview's long side, in px. Small keeps the grid cheap. */
const MAX_PREVIEW_LONG_SIDE = 384;
/** WebP still quality (0–1). Lower than default for compact previews. */
const PREVIEW_QUALITY = 0.75;

/**
 * Build an animated WebP preview of `doc`: at most `previewFrameBudget` frames,
 * downscaled so the long side is `MAX_PREVIEW_LONG_SIDE`, looping forever.
 */
export async function buildPreview(doc: ToonDocument): Promise<Uint8Array<ArrayBuffer>> {
  const logicalW = Math.max(1, Math.round(doc.width / FIXED_POINT_SCALE));
  const logicalH = Math.max(1, Math.round(doc.height / FIXED_POINT_SCALE));
  const { width, height } = downscaleSize(logicalW, logicalH, MAX_PREVIEW_LONG_SIDE);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('canvas 2d context unavailable');
  }

  const renderer = new Canvas2DFrameRenderer();
  // Player's doc-units→px mapping (1 / FIXED_POINT_SCALE) times the downscale.
  const viewport = { scale: width / logicalW / FIXED_POINT_SCALE, dpr: 1 };
  const count = Math.min(previewFrameBudget(doc.frame_rate), doc.frames.length);

  const stills: WebpStill[] = [];
  for (let i = 0; i < count; i++) {
    renderer.render(doc.frames[i], ctx as unknown as Canvas2DLike, viewport);
    stills.push({ data: await encodeStill(canvas), width, height });
  }
  return assembleAnimatedWebp(stills, { fps: doc.frame_rate });
}

/** Native WebP still-encode of the canvas's current pixels. */
function encodeStill(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('webp encoding unsupported'));
          return;
        }
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
      },
      'image/webp',
      PREVIEW_QUALITY,
    );
  });
}
