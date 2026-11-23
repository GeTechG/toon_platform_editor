/**
 * Bounded 4x4 (or 2x2) fixed-grid single-sample R8 + stencil coverage atlas
 * and pure slot/tile batch planner.
 *
 * Invariants:
 * - Every untiled operation whose complete clipped bbox fits in the logical
 *   atlas gets a disjoint integer-pixel slot `(atlasX, atlasY, w, h)` with
 *   1px padding, so batched strokes never bleed across slots.
 * - Any operation whose clipped bbox exceeds the logical atlas dimension is
 *   NEVER mixed into a multi-slot draw (J1-O10): each tile executes as a
 *   dedicated scissored pass over the atlas.
 * - Native 1x1 Canvas 2D reference masks (for >= 255 winding overflow or
 *   < 0.5 px subpixel features) upload to a separate 1x1 R8 texture and are
 *   composited with `uSampleMode = 2` (zero 4x4 resampling — J1-O9).
 */

import type { AtlasFormats } from './probe';

/** Minimal axis-aligned sheet-pixel bounds of one paint operation to pack. */
export interface AtlasOp {
  readonly id: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** One placed slot (or tile) inside an atlas pass. */
export interface AtlasSlot<T extends AtlasOp = AtlasOp> {
  readonly op: T;
  /** Destination sheet-pixel rectangle `[sheetX, sheetY, w, h]`. */
  readonly sheetX: number;
  readonly sheetY: number;
  readonly w: number;
  readonly h: number;
  /** Placement in logical atlas pixels `[atlasX, atlasY]`. */
  readonly atlasX: number;
  readonly atlasY: number;
}

/** One atlas clear -> rasterize -> composite pass. */
export interface AtlasBatch<T extends AtlasOp = AtlasOp> {
  readonly tiled: boolean;
  readonly slots: readonly AtlasSlot<T>[];
}

/**
 * Packs operations into sequential atlas batches preserving exact paint order.
 * Oversized operations split into dedicated single-slot `tiled: true` batches.
 */
export function planAtlasBatches<T extends AtlasOp>(
  ops: readonly T[],
  atlasLogicalSide: number,
  sheetW: number,
  sheetH: number,
): AtlasBatch<T>[] {
  const batches: AtlasBatch<T>[] = [];
  let curSlots: AtlasSlot<T>[] = [];
  let shelfX = 0;
  let shelfY = 0;
  let shelfH = 0;

  const flush = (): void => {
    if (curSlots.length > 0) {
      batches.push({ tiled: false, slots: curSlots });
      curSlots = [];
      shelfX = 0;
      shelfY = 0;
      shelfH = 0;
    }
  };

  for (const op of ops) {
    const ux0 = Math.floor(op.minX) - 1;
    const uy0 = Math.floor(op.minY) - 1;
    const ux1 = Math.ceil(op.maxX) + 1;
    const uy1 = Math.ceil(op.maxY) + 1;
    const x0 = Math.max(0, ux0);
    const y0 = Math.max(0, uy0);
    const x1 = Math.min(sheetW, ux1);
    const y1 = Math.min(sheetH, uy1);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) continue;

    // Any operation that is oversized OR crosses a sheet boundary (so its unclipped
    // geometry extends outside [x0..x1] x [y0..y1]) must run in dedicated isolated
    // scissored passes so unclipped triangles can never bleed into neighbour slots.
    const clippedBySheet = ux0 < 0 || uy0 < 0 || ux1 > sheetW || uy1 > sheetH;
    if (w > atlasLogicalSide || h > atlasLogicalSide || clippedBySheet) {
      flush();
      for (let ty = y0; ty < y1; ty += atlasLogicalSide) {
        const th = Math.min(atlasLogicalSide, y1 - ty);
        for (let tx = x0; tx < x1; tx += atlasLogicalSide) {
          const tw = Math.min(atlasLogicalSide, x1 - tx);
          batches.push({
            tiled: true,
            slots: [{ op, sheetX: tx, sheetY: ty, w: tw, h: th, atlasX: 0, atlasY: 0 }],
          });
        }
      }
      continue;
    }

    // Add 1 logical pixel guard band between adjacent untiled slots so bilinear
    // taps at slot edges never sample a neighbour.
    const pw = w + 1;
    const ph = h + 1;
    if (shelfX + pw > atlasLogicalSide) {
      shelfX = 0;
      shelfY += shelfH;
      shelfH = 0;
    }
    if (shelfY + ph > atlasLogicalSide) {
      flush();
    }
    curSlots.push({ op, sheetX: x0, sheetY: y0, w, h, atlasX: shelfX, atlasY: shelfY });
    shelfX += pw;
    if (ph > shelfH) shelfH = ph;
  }
  flush();
  return batches;
}

/** GPU resources for the fixed-grid supersampled coverage atlas + native 1x1 reference mask texture. */
export class CoverageAtlas {
  readonly gl: WebGL2RenderingContext;
  readonly formats: AtlasFormats;
  readonly supersample: number;
  readonly logicalSide: number;
  readonly physSide: number;

  readonly fbo: WebGLFramebuffer;
  readonly texture: WebGLTexture;
  readonly stencilRb: WebGLRenderbuffer;

  #refRgbaTex: WebGLTexture | null = null;
  #refRgbaW = 0;
  #refRgbaH = 0;
  #disposed = false;

  /**
   * Non-throwing factory so WebGL allocation/OOM/context-loss failures cleanly
   * return `null` instead of throwing out of `composeAndPresent`.
   */
  static create(
    gl: WebGL2RenderingContext,
    formats: AtlasFormats,
    logicalSide: number,
    supersample = 4,
  ): CoverageAtlas | null {
    const physSide = logicalSide * supersample;
    const fbo = gl.createFramebuffer();
    const tex = gl.createTexture();
    const rb = gl.createRenderbuffer();
    if (!fbo || !tex || !rb) {
      if (fbo) gl.deleteFramebuffer(fbo);
      if (tex) gl.deleteTexture(tex);
      if (rb) gl.deleteRenderbuffer(rb);
      return null;
    }

    const internal = formats.color === 'R8' ? gl.R8 : gl.RGBA8;
    const format = formats.color === 'R8' ? gl.RED : gl.RGBA;
    const rbInternal = formats.stencil === 'STENCIL_INDEX8' ? gl.STENCIL_INDEX8 : gl.DEPTH24_STENCIL8;
    const attachment = formats.stencil === 'STENCIL_INDEX8' ? gl.STENCIL_ATTACHMENT : gl.DEPTH_STENCIL_ATTACHMENT;

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, physSide, physSide, 0, format, gl.UNSIGNED_BYTE, null);

    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, rbInternal, physSide, physSide);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attachment, gl.RENDERBUFFER, rb);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);

    if (status !== gl.FRAMEBUFFER_COMPLETE || gl.isContextLost()) {
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      gl.deleteRenderbuffer(rb);
      return null;
    }

    return new CoverageAtlas(gl, formats, logicalSide, supersample, physSide, fbo, tex, rb);
  }

  private constructor(
    gl: WebGL2RenderingContext,
    formats: AtlasFormats,
    logicalSide: number,
    supersample: number,
    physSide: number,
    fbo: WebGLFramebuffer,
    tex: WebGLTexture,
    rb: WebGLRenderbuffer,
  ) {
    this.gl = gl;
    this.formats = formats;
    this.supersample = supersample;
    this.logicalSide = logicalSide;
    this.physSide = physSide;
    this.fbo = fbo;
    this.texture = tex;
    this.stencilRb = rb;
  }

  /**
   * Uploads a bounded native 1x1 premultiplied RGBA8 tile (`w, h <= logicalSide`)
   * rasterized by Canvas 2D for winding-overflow or subpixel fallback strokes.
   * Bounded to `logicalSide x logicalSide` so VRAM never exceeds `nativeFallbackTileBytes`.
   */
  uploadNativeRgba(premulRgba: Uint8Array, w: number, h: number): WebGLTexture | null {
    if (w <= 0 || h <= 0 || w > this.logicalSide || h > this.logicalSide) {
      return null;
    }
    const gl = this.gl;
    if (!this.#refRgbaTex) {
      this.#refRgbaTex = gl.createTexture();
      if (!this.#refRgbaTex) return null;
      gl.bindTexture(gl.TEXTURE_2D, this.#refRgbaTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.#refRgbaTex);
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    if (w !== this.#refRgbaW || h !== this.#refRgbaH) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, premulRgba);
      this.#refRgbaW = w;
      this.#refRgbaH = h;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, premulRgba);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    return this.#refRgbaTex;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const gl = this.gl;
    gl.deleteFramebuffer(this.fbo);
    gl.deleteTexture(this.texture);
    gl.deleteRenderbuffer(this.stencilRb);
    if (this.#refRgbaTex) {
      gl.deleteTexture(this.#refRgbaTex);
      this.#refRgbaTex = null;
    }
  }
}
