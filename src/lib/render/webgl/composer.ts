/**
 * Studio WebGL2 SheetComposer implementation (`WebGL2SheetComposer`).
 *
 * Uses one validated WebGL2 context, a bounded 4x4 fixed-grid single-sample
 * R8 + stencil coverage atlas, a VRAM-budgeted working + retained layer stack,
 * lazy 15-mode W3C blend shaders, unpremultiplied 1x1 pipette readback, and
 * strict OUT_OF_MEMORY generation poisoning.
 */

import { FIXED_POINT_SCALE } from '../../format/constants';
import { opacityOf, type BlendMode, type Frame, type ToolDescriptor } from '../../format/types';
import { resolveCell } from '../../model/cells';
import { hasLook, renderStrokesLayer, type Canvas2DLike, type LayerLook, type PlacedStroke } from '../canvas2d';
import { extendsFlatRun, hasInteriorPaint, isEraserTool, isFilledLineTool, isFlatPaint, resolveTool, sameFlatPaint } from '../dispatch';
import type { FrameScene, GhostFrame, LiveLine } from '../frame-compose';
import type { SheetComposer, SamplePixelRequest, StagePresentParams, StraightRgba } from '../sheet-composer';
import { CoverageAtlas, planAtlasBatches, type AtlasOp } from './atlas';
import type { AtlasFormats, RenderBackendReason } from './probe';
import {
  BLEND_FS,
  BLIT_FS,
  BLIT_VS,
  COMPOSITE_FS,
  COMPOSITE_VS,
  COVERAGE_FS,
  COVERAGE_VS,
  COVER_QUAD_VS,
  PRESENT_FS,
  PRESENT_VS,
  blendModeId,
  compileProgram,
  parseHexRgb,
} from './shaders';
import {
  GeometryKeeper,
  tessellateLivePolyline,
  tessellateStroke,
  type StrokeMesh,
} from './tessellate';
import {
  VramBudget,
  planSceneVram,
  sheetTextureBytes,
  vboBudgetForTier,
} from './vram-budget';

/** Converts premultiplied 8-bit RGBA back to straight 8-bit RGBA for `colourOfPixel`. */
export function unpremultiplyRgba(r: number, g: number, b: number, a: number): StraightRgba {
  if (a <= 0) return [0, 0, 0, 0];
  if (a >= 255) return [r, g, b, 255];
  const inv = 255 / a;
  return [
    Math.min(255, Math.round(r * inv)),
    Math.min(255, Math.round(g * inv)),
    Math.min(255, Math.round(b * inv)),
    a,
  ];
}

export interface WebGL2ComposerOptions {
  readonly formats: AtlasFormats;
  readonly budgetBytes: number;
  /** Fixed-grid supersampling factor: 4 (16 subpixels, default) or 2 (4 subpixels). */
  readonly supersample?: 2 | 4;
}

interface TextureTarget {
  readonly tex: WebGLTexture;
  readonly fbo: WebGLFramebuffer;
  width: number;
  height: number;
  mipmapped: boolean;
  immutableMips: boolean;
}

interface PaintOp extends AtlasOp {
  readonly mode: 'union' | 'nonzero' | 'reference';
  readonly vertices: Float32Array;
  readonly matIndex: 0 | 1;
  readonly color: [number, number, number];
  readonly alpha: number;
  readonly erase: boolean;
  /** Original stroke + tool for bounded Canvas 2D reference fallback (`mode === 'reference'`). */
  readonly refStroke?: PlacedStroke;
  readonly refTool?: ToolDescriptor;
}

interface LayerChunkTex {
  readonly target: TextureTarget;
  readonly look: LayerLook | undefined;
  readonly ink: boolean;
}

function createTarget(gl: WebGL2RenderingContext, width: number, height: number, mipmapped: boolean): TextureTarget | null {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) {
    if (tex) gl.deleteTexture(tex);
    if (fbo) gl.deleteFramebuffer(fbo);
    return null;
  }
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // Always keep working textures on base-level LINEAR filtering; mipmapped
  // sampling is enabled exclusively inside `#presentSheet` after `generateMipmap`
  // and restored immediately afterward so working passes never sample an
  // incomplete mip chain.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  let immutableMips = false;
  if (mipmapped && typeof gl.texStorage2D === 'function') {
    const levels = Math.floor(Math.log2(Math.max(1, width, height))) + 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, width, height);
    immutableMips = true;
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { tex, fbo, width, height, mipmapped, immutableMips };
}

function deleteTarget(gl: WebGL2RenderingContext, target: TextureTarget | null): void {
  if (!target) return;
  gl.deleteFramebuffer(target.fbo);
  gl.deleteTexture(target.tex);
}

function toolColorHex(tool: ToolDescriptor): string {
  return 'color' in tool ? tool.color : '#000000';
}

function hasEraser(frame: Frame, tools: readonly ToolDescriptor[]): boolean {
  return frame.strokes.some((s) => isEraserTool(resolveTool(tools, s)));
}

function showsBlend(scene: FrameScene): boolean {
  return scene.doc.layers.some((layer) => !layer.hidden && layer.blend !== undefined);
}

function writeAffineMat3(
  out: Float32Array,
  offset: number,
  a: number, b: number, c: number, d: number, e: number, f: number,
): void {
  out[offset] = a; out[offset + 1] = b; out[offset + 2] = 0;
  out[offset + 3] = c; out[offset + 4] = d; out[offset + 5] = 0;
  out[offset + 6] = e; out[offset + 7] = f; out[offset + 8] = 1;
}

interface CovLocs {
  uMatrices: WebGLUniformLocation | null;
  uSupersample: WebGLUniformLocation | null;
  uAtlasPhys: WebGLUniformLocation | null;
}

interface CoverLocs {
  uAtlasPhys: WebGLUniformLocation | null;
}

interface CompLocs {
  uDstSize: WebGLUniformLocation | null;
  uMaskPhysSize: WebGLUniformLocation | null;
  uSampleMode: WebGLUniformLocation | null;
  uMask: WebGLUniformLocation | null;
}

interface BlitLocs {
  uTex: WebGLUniformLocation | null;
  uAlpha: WebGLUniformLocation | null;
  uTintMode: WebGLUniformLocation | null;
  uTint: WebGLUniformLocation | null;
  uUvOrigin: WebGLUniformLocation | null;
  uUvSpan: WebGLUniformLocation | null;
}

interface BlendLocs {
  uDst: WebGLUniformLocation | null;
  uSrc: WebGLUniformLocation | null;
  uOpacity: WebGLUniformLocation | null;
  uMode: WebGLUniformLocation | null;
  uUvOrigin: WebGLUniformLocation | null;
  uUvSpan: WebGLUniformLocation | null;
}

interface PresentLocs {
  uSheet: WebGLUniformLocation | null;
  uStageSize: WebGLUniformLocation | null;
  uSheetOrigin: WebGLUniformLocation | null;
  uSheetSize: WebGLUniformLocation | null;
  uCosSin: WebGLUniformLocation | null;
  uPaper: WebGLUniformLocation | null;
  uGridStep: WebGLUniformLocation | null;
}

function transformBounds(
  bounds: readonly [number, number, number, number],
  m: readonly [number, number, number, number, number, number],
): [number, number, number, number] {
  const [x0, y0, x1, y1] = bounds;
  const [a, b, c, d, e, f] = m;
  const corners: [number, number][] = [
    [a * x0 + c * y0 + e, b * x0 + d * y0 + f],
    [a * x1 + c * y0 + e, b * x1 + d * y0 + f],
    [a * x1 + c * y1 + e, b * x1 + d * y1 + f],
    [a * x0 + c * y1 + e, b * x0 + d * y1 + f],
  ];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [cx, cy] of corners) {
    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;
  }
  return [minX, minY, maxX, maxY];
}

function sameStrokeList(a: readonly unknown[] | undefined, b: readonly unknown[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Studio WebGL2 SheetComposer.
 * Owns one context's programs, atlas, working targets, retained layer/ghost/playback
 * textures, and GeometryKeeper mesh cache.
 */
export class WebGL2SheetComposer implements SheetComposer {
  readonly kind = 'webgl2' as const;

  readonly #gl: WebGL2RenderingContext;
  readonly #formats: AtlasFormats;
  readonly #supersample: 2 | 4;
  readonly #budget: VramBudget;
  readonly #meshes: GeometryKeeper;

  // Compiled GL programs (blend program is compiled lazily on first blended layer)
  // and their cached uniform locations.
  #covProg: WebGLProgram | null = null;
  #covLocs: CovLocs | null = null;
  #coverQuadProg: WebGLProgram | null = null;
  #coverLocs: CoverLocs | null = null;
  #compProg: WebGLProgram | null = null;
  #compLocs: CompLocs | null = null;
  #blitProg: WebGLProgram | null = null;
  #blitLocs: BlitLocs | null = null;
  #blendProg: WebGLProgram | null = null;
  #blendLocs: BlendLocs | null = null;
  #presentProg: WebGLProgram | null = null;
  #presentLocs: PresentLocs | null = null;

  // Shared streaming VBO (ring-buffered via WebGL2 bufferSubData) + static quad VBOs.
  #streamVbo: WebGLBuffer | null = null;
  #streamVboBytes = 0;
  #streamVboCursor = 0;
  #streamScratch: Float32Array | null = null;
  readonly #matrices = new Float32Array(18);
  #quadVbo: WebGLBuffer | null = null;
  #unitQuadVbo: WebGLBuffer | null = null;

  // Coverage atlas (bounded 256/512 logical).
  #atlas: CoverageAtlas | null = null;

  // Required working surfaces: slotA (sheet/pingA), slotB (layer/pingB), slotC (flat-coat mask),
  // plus pinned `#under` when ghosts are active and 1x1 pipette readback targets.
  #slotA: TextureTarget | null = null;
  #slotB: TextureTarget | null = null;
  #slotC: TextureTarget | null = null;
  #underTex: TextureTarget | null = null;
  #pickTex: TextureTarget | null = null;
  #pickScratch: TextureTarget | null = null;

  // Retained layer stack cache (allocated strictly from VramBudget headroom).
  #belowChunks: LayerChunkTex[] = [];
  #belowComplete = false;
  #activeTex: TextureTarget | null = null;
  #activeLook: LayerLook | undefined;
  #aboveChunks: LayerChunkTex[] = [];
  #aboveComplete = false;
  #stackValid = false;
  #stale = true;
  #sheetW = 0;
  #sheetH = 0;
  #lastScene: FrameScene | null = null;
  #activeInk: unknown[] | undefined;
  #belowInk: unknown[] | undefined;
  #aboveInk: unknown[] | undefined;
  #underInk: unknown[] | undefined;

  // Retained GPU playback cache (allocated strictly from VramBudget headroom).
  #playbackDoc: FrameScene['doc'] | null = null;
  #playbackTextures = new Map<number, TextureTarget>();

  // Scratch Canvas 2D for bounded native 1x1 reference coverage masks (winding-overflow / subpixel).
  #refCanvas: HTMLCanvasElement | null = null;

  #disposed = false;
  #lastFailure: RenderBackendReason | null = null;
  /** True whenever GPU memory was allocated/grown since the last `gl.getError()` check. */
  #needsErrorCheck = false;
  /** Tracks whether any retained chunk of `below`/`above` was evicted during the current stack build (F1). */
  #evictedBelow = false;
  #evictedAbove = false;

  constructor(gl: WebGL2RenderingContext, options: WebGL2ComposerOptions) {
    this.#gl = gl;
    this.#formats = options.formats;
    this.#supersample = options.supersample ?? 4;
    this.#budget = new VramBudget(options.budgetBytes);
    this.#meshes = new GeometryKeeper(Math.min(32 * 1024 * 1024, Math.floor(options.budgetBytes / 2)));
  }

  get lastFailure(): RenderBackendReason | null {
    return this.#lastFailure;
  }

  invalidate(): void {
    this.#stale = true;
  }

  clearPlayback(): void {
    for (const [key] of this.#playbackTextures) {
      this.#budget.release(`play:${key}`);
    }
    this.#playbackTextures.clear();
    this.#playbackDoc = null;
  }

  composeAndPresent(
    sheetWidth: number,
    sheetHeight: number,
    scene: FrameScene,
    present: StagePresentParams,
    playbackKey?: { readonly doc: FrameScene['doc']; readonly key: number; readonly total: number },
  ): boolean {
    if (this.#disposed || this.#budget.oom || this.#gl.isContextLost()) {
      this.#lastFailure ??= this.#budget.oom ? 'oom' : 'context-lost';
      return false;
    }

    const hasGhosts = Boolean(scene.ghosts && scene.ghosts.frames.length > 0);
    const hasBlend = showsBlend(scene);
    const hasLiveCoat = Boolean(scene.live?.flat);
    const needsMipmap = present.stretch < 1;

    // Release `#underTex` immediately when onion skin is turned off BEFORE
    // reclaiming its VRAM reservation so live GPU bytes never exceed budget (F7).
    if (!hasGhosts && this.#underTex) {
      deleteTarget(this.#gl, this.#underTex);
      this.#underTex = null;
      this.#underInk = undefined;
    }

    // 1. Preflight VRAM check before allocating GL textures (J1-O5).
    const plan = planSceneVram({
      budgetBytes: this.#budget.budget,
      sheetWidth,
      sheetHeight,
      formats: this.#formats,
      supersample: this.#supersample,
      needsMipmap,
      hasGhosts,
      hasBlend,
      hasLiveCoat,
    });
    if (!plan.fits || !this.#budget.reserveWorking(plan.workingBytes)) {
      this.#lastFailure = 'budget-exceeded';
      return false;
    }

    // 2. Ensure core GL programs, buffers, atlas, and working slots exist.
    if (!this.#ensureCore(sheetWidth, sheetHeight, plan.atlasLogicalSide, needsMipmap, hasGhosts)) {
      return false;
    }

    // 3. Playback still cache fast path (must match sheet size AND mipmap requirement).
    if (playbackKey) {
      if (this.#playbackDoc !== playbackKey.doc) {
        this.clearPlayback();
        this.#playbackDoc = playbackKey.doc;
      }
      const cached = this.#playbackTextures.get(playbackKey.key);
      if (cached && cached.width === sheetWidth && cached.height === sheetHeight && cached.mipmapped === needsMipmap) {
        if (this.#needsErrorCheck && !this.#checkHealthy()) return false;
        this.#budget.touch(`play:${playbackKey.key}`);
        this.#presentSheet(cached, present);
        return this.#checkHealthy();
      }
    }

    // 4. Rebuild committed stack if stale or resized.
    this.#lastScene = scene;
    if (this.#stale || this.#sheetW !== sheetWidth || this.#sheetH !== sheetHeight || !this.#stackValid) {
      if (!this.#rebuildStack(scene, sheetWidth, sheetHeight)) {
        return false;
      }
      this.#stale = false;
      this.#sheetW = sheetWidth;
      this.#sheetH = sheetHeight;
      this.#stackValid = true;
    }

    // 5. Composite stack + ghosts + live line into slotA.
    if (!this.#composeFrame(scene, sheetWidth, sheetHeight, hasGhosts)) {
      return false;
    }

    // 6. Store playback still in GPU VRAM if headroom allows (reserve & evict BEFORE allocating,
    // budgeting and generating mipmaps when minified so cache hits match first-pass filtering).
    if (playbackKey && this.#slotA) {
      const bytes = sheetTextureBytes(sheetWidth, sheetHeight, needsMipmap);
      let copy: TextureTarget | null = null;
      if (this.#budget.tryRetain(`play:${playbackKey.key}`, bytes, () => {
        if (copy) deleteTarget(this.#gl, copy);
        this.#playbackTextures.delete(playbackKey.key);
      })) {
        this.#needsErrorCheck = true;
        copy = createTarget(this.#gl, sheetWidth, sheetHeight, needsMipmap);
        if (copy) {
          this.#blitTex(this.#slotA.tex, copy, 1, null, false);
          if (needsMipmap) {
            const gl = this.#gl;
            gl.bindTexture(gl.TEXTURE_2D, copy.tex);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.bindTexture(gl.TEXTURE_2D, null);
          }
          this.#playbackTextures.set(playbackKey.key, copy);
        } else {
          this.#budget.release(`play:${playbackKey.key}`);
        }
      }
    }

    // 7. Present slotA onto onscreen canvas.
    if (this.#slotA) {
      this.#presentSheet(this.#slotA, present);
    }

    return this.#checkHealthy();
  }

  samplePixel(req: SamplePixelRequest): StraightRgba | null {
    if (this.#disposed || this.#budget.oom || this.#gl.isContextLost() || !this.#stackValid || !this.#lastScene || !this.#slotB) {
      return null;
    }
    const gl = this.#gl;
    if (!this.#pickTex) {
      this.#pickTex = createTarget(gl, 1, 1, false);
      if (!this.#pickTex) return null;
    }
    const px = Math.min(this.#sheetW - 1, Math.max(0, Math.floor(req.px)));
    const py = Math.min(this.#sheetH - 1, Math.max(0, Math.floor(req.py)));
    const u0 = px / this.#sheetW;
    const v0 = py / this.#sheetH;
    const du = 1 / this.#sheetW;
    const dv = 1 / this.#sheetH;
    const scene = this.#lastScene;
    const slotB = this.#slotB;

    // Composite committed layers at 1x1 into #pickTex (no onion, no live stroke).
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#pickTex.fbo);
    gl.viewport(0, 0, 1, 1);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    if (req.onPaper) {
      const [pr, pg, pb] = parseHexRgb(req.paper);
      gl.clearColor(pr, pg, pb, 1);
    } else {
      gl.clearColor(0, 0, 0, 0);
    }
    gl.clear(gl.COLOR_BUFFER_BIT);

    const streamLayerToPick = (layerIdx: number, applyLook: boolean): void => {
      const layer = scene.doc.layers[layerIdx];
      const cell = this.#cell(scene, layerIdx);
      if (!cell || layer?.hidden || cell.strokes.length === 0) return;
      this.#clearTarget(slotB, 0, 0, 0, 0);
      this.#renderCellStrokes(cell, scene.tools, scene.viewport, slotB, false);
      this.#layChunkOnPick(slotB.tex, applyLook && hasLook(layer) ? layer : undefined, u0, v0, du, dv);
    };

    if (req.source === 'layer') {
      if (this.#activeTex) {
        this.#blitSubRect(this.#activeTex.tex, this.#pickTex, 1, u0, v0, du, dv, true);
      } else {
        streamLayerToPick(scene.activeLayer, false);
      }
    } else {
      if (this.#belowComplete) {
        for (const chunk of this.#belowChunks) {
          if (chunk.ink) this.#layChunkOnPick(chunk.target.tex, chunk.look, u0, v0, du, dv);
        }
      } else {
        for (let l = 0; l < scene.activeLayer; l++) streamLayerToPick(l, true);
      }

      if (this.#activeTex) {
        this.#layChunkOnPick(this.#activeTex.tex, this.#activeLook, u0, v0, du, dv);
      } else {
        streamLayerToPick(scene.activeLayer, true);
      }

      if (this.#aboveComplete) {
        for (const chunk of this.#aboveChunks) {
          if (chunk.ink) this.#layChunkOnPick(chunk.target.tex, chunk.look, u0, v0, du, dv);
        }
      } else {
        for (let l = scene.activeLayer + 1; l < scene.doc.layers.length; l++) streamLayerToPick(l, true);
      }
    }

    const buf = new Uint8Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#pickTex.fbo);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!this.#checkHealthy(true)) return null;
    return unpremultiplyRgba(buf[0], buf[1], buf[2], buf[3]);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const gl = this.#gl;

    this.#budget.clearRetained();
    this.#playbackTextures.clear();
    this.#belowChunks = [];
    this.#belowComplete = false;
    this.#aboveChunks = [];
    this.#aboveComplete = false;
    this.#activeTex = null;
    this.#lastScene = null;

    deleteTarget(gl, this.#slotA);
    deleteTarget(gl, this.#slotB);
    deleteTarget(gl, this.#slotC);
    deleteTarget(gl, this.#underTex);
    deleteTarget(gl, this.#pickTex);
    deleteTarget(gl, this.#pickScratch);
    this.#slotA = this.#slotB = this.#slotC = this.#underTex = this.#pickTex = this.#pickScratch = null;

    this.#atlas?.dispose();
    this.#atlas = null;

    if (this.#streamVbo) gl.deleteBuffer(this.#streamVbo);
    if (this.#quadVbo) gl.deleteBuffer(this.#quadVbo);
    if (this.#unitQuadVbo) gl.deleteBuffer(this.#unitQuadVbo);
    this.#streamVbo = this.#quadVbo = this.#unitQuadVbo = null;
    this.#streamVboBytes = 0;
    this.#streamVboCursor = 0;
    this.#streamScratch = null;

    if (this.#covProg) gl.deleteProgram(this.#covProg);
    if (this.#coverQuadProg) gl.deleteProgram(this.#coverQuadProg);
    if (this.#compProg) gl.deleteProgram(this.#compProg);
    if (this.#blitProg) gl.deleteProgram(this.#blitProg);
    if (this.#blendProg) gl.deleteProgram(this.#blendProg);
    if (this.#presentProg) gl.deleteProgram(this.#presentProg);
    this.#covProg = this.#coverQuadProg = this.#compProg = this.#blitProg = this.#blendProg = this.#presentProg = null;
    this.#covLocs = this.#coverLocs = this.#compLocs = this.#blitLocs = this.#blendLocs = this.#presentLocs = null;

    this.#meshes.clear();
    if (this.#refCanvas) {
      this.#refCanvas.width = 0;
      this.#refCanvas.height = 0;
      this.#refCanvas = null;
    }
  }

  #checkHealthy(forceErrorCheck = false): boolean {
    const gl = this.#gl;
    if (gl.isContextLost()) {
      this.#lastFailure = 'context-lost';
      this.dispose();
      return false;
    }
    if (forceErrorCheck || this.#needsErrorCheck) {
      this.#needsErrorCheck = false;
      const err = gl.getError();
      if (err === gl.OUT_OF_MEMORY) {
        this.#lastFailure = 'oom';
        this.#budget.markOutOfMemory();
        this.dispose();
        return false;
      }
    }
    return true;
  }

  #ensureCore(w: number, h: number, atlasSide: number, needsMipmap: boolean, hasGhosts: boolean): boolean {
    const gl = this.#gl;
    if (!this.#covProg) {
      this.#covProg = compileProgram(gl, COVERAGE_VS, COVERAGE_FS);
      this.#coverQuadProg = compileProgram(gl, COVER_QUAD_VS, COVERAGE_FS);
      this.#compProg = compileProgram(gl, COMPOSITE_VS, COMPOSITE_FS);
      this.#blitProg = compileProgram(gl, BLIT_VS, BLIT_FS);
      this.#presentProg = compileProgram(gl, PRESENT_VS, PRESENT_FS);
      if (!this.#covProg || !this.#coverQuadProg || !this.#compProg || !this.#blitProg || !this.#presentProg) {
        this.#lastFailure = 'webgl2-unavailable';
        return false;
      }
      this.#covLocs = {
        uMatrices: gl.getUniformLocation(this.#covProg, 'uMatrices'),
        uSupersample: gl.getUniformLocation(this.#covProg, 'uSupersample'),
        uAtlasPhys: gl.getUniformLocation(this.#covProg, 'uAtlasPhys'),
      };
      this.#coverLocs = {
        uAtlasPhys: gl.getUniformLocation(this.#coverQuadProg, 'uAtlasPhys'),
      };
      this.#compLocs = {
        uDstSize: gl.getUniformLocation(this.#compProg, 'uDstSize'),
        uMaskPhysSize: gl.getUniformLocation(this.#compProg, 'uMaskPhysSize'),
        uSampleMode: gl.getUniformLocation(this.#compProg, 'uSampleMode'),
        uMask: gl.getUniformLocation(this.#compProg, 'uMask'),
      };
      this.#blitLocs = {
        uTex: gl.getUniformLocation(this.#blitProg, 'uTex'),
        uAlpha: gl.getUniformLocation(this.#blitProg, 'uAlpha'),
        uTintMode: gl.getUniformLocation(this.#blitProg, 'uTintMode'),
        uTint: gl.getUniformLocation(this.#blitProg, 'uTint'),
        uUvOrigin: gl.getUniformLocation(this.#blitProg, 'uUvOrigin'),
        uUvSpan: gl.getUniformLocation(this.#blitProg, 'uUvSpan'),
      };
      this.#presentLocs = {
        uSheet: gl.getUniformLocation(this.#presentProg, 'uSheet'),
        uStageSize: gl.getUniformLocation(this.#presentProg, 'uStageSize'),
        uSheetOrigin: gl.getUniformLocation(this.#presentProg, 'uSheetOrigin'),
        uSheetSize: gl.getUniformLocation(this.#presentProg, 'uSheetSize'),
        uCosSin: gl.getUniformLocation(this.#presentProg, 'uCosSin'),
        uPaper: gl.getUniformLocation(this.#presentProg, 'uPaper'),
        uGridStep: gl.getUniformLocation(this.#presentProg, 'uGridStep'),
      };
      this.#streamVbo = gl.createBuffer();
      this.#quadVbo = gl.createBuffer();
      this.#unitQuadVbo = gl.createBuffer();
      if (!this.#streamVbo || !this.#quadVbo || !this.#unitQuadVbo) {
        this.#lastFailure = 'oom';
        return false;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.#quadVbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.#unitQuadVbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
      // Pre-allocate the streaming VBO to its budgeted tier capacity (already
      // reserved in planSceneVram().workingBytes) so mid-session stroke growth
      // does not trigger repeated bufferData doublings and gl.getError() IPC stalls.
      this.#streamVboBytes = vboBudgetForTier(this.#budget.budget);
      this.#streamVboCursor = 0;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.#streamVbo);
      gl.bufferData(gl.ARRAY_BUFFER, this.#streamVboBytes, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.#needsErrorCheck = true;
    }

    if (!this.#atlas || this.#atlas.logicalSide !== atlasSide) {
      this.#atlas?.dispose();
      this.#atlas = CoverageAtlas.create(gl, this.#formats, atlasSide, this.#supersample);
      if (!this.#atlas) {
        this.#lastFailure = gl.isContextLost() ? 'context-lost' : 'oom';
        if (this.#lastFailure === 'oom') this.#budget.markOutOfMemory();
        this.dispose();
        return false;
      }
      this.#needsErrorCheck = true;
    }

    if (!this.#slotA || this.#slotA.width !== w || this.#slotA.height !== h || this.#slotA.mipmapped !== needsMipmap) {
      this.#budget.clearRetained();
      this.#belowChunks = [];
      this.#belowComplete = false;
      this.#aboveChunks = [];
      this.#aboveComplete = false;
      this.#activeTex = null;
      this.#activeInk = undefined;
      this.#belowInk = undefined;
      this.#aboveInk = undefined;
      this.#underInk = undefined;
      this.#stackValid = false;
      this.#playbackTextures.clear();

      deleteTarget(gl, this.#slotA);
      deleteTarget(gl, this.#slotB);
      deleteTarget(gl, this.#slotC);
      deleteTarget(gl, this.#underTex);
      this.#slotA = createTarget(gl, w, h, needsMipmap);
      this.#slotB = createTarget(gl, w, h, false);
      this.#slotC = createTarget(gl, w, h, false);
      this.#underTex = hasGhosts ? createTarget(gl, w, h, false) : null;
      if (!this.#slotA || !this.#slotB || !this.#slotC || (hasGhosts && !this.#underTex)) {
        this.#lastFailure = 'oom';
        this.#budget.markOutOfMemory();
        this.dispose();
        return false;
      }
      this.#needsErrorCheck = true;
    } else if (hasGhosts && !this.#underTex) {
      this.#underTex = createTarget(gl, w, h, false);
      if (!this.#underTex) {
        this.#lastFailure = 'oom';
        this.#budget.markOutOfMemory();
        this.dispose();
        return false;
      }
      this.#needsErrorCheck = true;
    }
    if (gl.isContextLost()) {
      this.#lastFailure = 'context-lost';
      this.dispose();
      return false;
    }
    return true;
  }

  #ensureBlendProgram(): WebGLProgram | null {
    if (!this.#blendProg) {
      const gl = this.#gl;
      this.#needsErrorCheck = true;
      this.#blendProg = compileProgram(gl, BLIT_VS, BLEND_FS);
      if (this.#blendProg) {
        this.#blendLocs = {
          uDst: gl.getUniformLocation(this.#blendProg, 'uDst'),
          uSrc: gl.getUniformLocation(this.#blendProg, 'uSrc'),
          uOpacity: gl.getUniformLocation(this.#blendProg, 'uOpacity'),
          uMode: gl.getUniformLocation(this.#blendProg, 'uMode'),
          uUvOrigin: gl.getUniformLocation(this.#blendProg, 'uUvOrigin'),
          uUvSpan: gl.getUniformLocation(this.#blendProg, 'uUvSpan'),
        };
      }
    }
    return this.#blendProg;
  }

  /** Returns a reusable CPU Float32Array of at least `minFloats` (capped to VBO tier budget). */
  #ensureStreamScratch(minFloats: number): Float32Array {
    const maxFloats = Math.floor(vboBudgetForTier(this.#budget.budget) / 4);
    const needed = Math.min(minFloats, maxFloats);
    if (!this.#streamScratch || this.#streamScratch.length < needed) {
      let next = this.#streamScratch ? this.#streamScratch.length : 16_384;
      while (next < needed) next *= 2;
      this.#streamScratch = new Float32Array(Math.min(next, maxFloats));
    }
    return this.#streamScratch;
  }

  /**
   * Ring-uploads `floatsCount` elements from `#streamScratch[0..floatsCount)` into
   * `#streamVbo` via WebGL2 `bufferSubData(target, dstByteOffset, src, 0, length)`.
   * Never allocates temporary TypedArrays or `subarray()` views, and caps `#streamVbo`
   * strictly within `vboBudgetForTier`. Returns the byte offset inside `#streamVbo`.
   */
  #uploadStream(floatsCount: number): number {
    const gl = this.#gl;
    const bytes = floatsCount * 4;
    const maxVboBytes = vboBudgetForTier(this.#budget.budget);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#streamVbo);
    if (bytes > this.#streamVboBytes) {
      let nextCap = this.#streamVboBytes > 0 ? this.#streamVboBytes : 64 * 1024;
      while (nextCap < bytes) nextCap *= 2;
      this.#streamVboBytes = Math.min(nextCap, maxVboBytes);
      this.#needsErrorCheck = true;
      gl.bufferData(gl.ARRAY_BUFFER, this.#streamVboBytes, gl.DYNAMIC_DRAW);
      this.#streamVboCursor = 0;
    } else if (this.#streamVboCursor + bytes > this.#streamVboBytes) {
      if (this.#streamVboBytes < maxVboBytes) {
        this.#streamVboBytes = Math.min(maxVboBytes, Math.max(bytes, this.#streamVboBytes * 2));
      }
      this.#needsErrorCheck = true;
      gl.bufferData(gl.ARRAY_BUFFER, this.#streamVboBytes, gl.DYNAMIC_DRAW);
      this.#streamVboCursor = 0;
    }
    const offset = this.#streamVboCursor;
    gl.bufferSubData(gl.ARRAY_BUFFER, offset, this.#streamScratch!, 0, floatsCount);
    this.#streamVboCursor = offset + bytes;
    return offset;
  }

  #cell(scene: FrameScene, layerIndex: number): Frame | undefined {
    const row = scene.doc.layers[layerIndex];
    const own = row && scene.frame < row.frames.length ? resolveCell(row, scene.frame) : undefined;
    return scene.cellAt ? scene.cellAt(layerIndex, scene.frame) : own;
  }

  #retainLayerTarget(key: string, w: number, h: number, onEvict?: (target: TextureTarget) => void): TextureTarget | null {
    const bytes = sheetTextureBytes(w, h, false);
    // Reserve & proactively evict BEFORE calling createTarget so live GPU
    // texture bytes never transiently exceed the tier budget.
    let target: TextureTarget | null = null;
    if (!this.#budget.tryRetain(key, bytes, () => {
      if (target) {
        deleteTarget(this.#gl, target);
        onEvict?.(target);
      }
    })) {
      return null;
    }
    this.#needsErrorCheck = true;
    target = createTarget(this.#gl, w, h, false);
    if (!target) {
      this.#budget.release(key);
      return null;
    }
    return target;
  }

  #rebuildStack(scene: FrameScene, w: number, h: number): boolean {
    const layers = scene.doc.layers;
    const below: { cell: Frame; look: LayerLook }[] = [];
    const above: { cell: Frame; look: LayerLook }[] = [];
    for (let l = 0; l < layers.length; l++) {
      const cell = this.#cell(scene, l);
      if (!cell || layers[l].hidden || l === scene.activeLayer) continue;
      if (l < scene.activeLayer) below.push({ cell, look: layers[l] });
      else above.push({ cell, look: layers[l] });
    }

    // Active layer target (retained if headroom allows, else streamed via slotB during compose).
    const activeCell = this.#cell(scene, scene.activeLayer);
    const ownLayer = layers[scene.activeLayer];
    this.#activeLook = ownLayer && hasLook(ownLayer) ? { opacity: ownLayer.opacity, blend: ownLayer.blend } : undefined;
    const activeVisible = activeCell && !ownLayer?.hidden ? activeCell : { strokes: [] };
    // 4 entries per stroke: points, tool, pressure, rigid lasso `place` matrix.
    const nextInk = activeVisible.strokes.flatMap((s) => [s.points, scene.tools[s.tool_id], s.pressure, (s as PlacedStroke).place]);

    // Phase 1: Acquire/reuse ALL stack targets (`active`, `below`, `above`) BEFORE
    // submitting any rasterization draws, so a single pre-draw `gl.getError()`
    // validates every allocation at once and aborts with zero wasted draws on OOM.
    if (!this.#activeTex) {
      this.#activeTex = this.#retainLayerTarget('layer:active', w, h, (evicted) => {
        if (this.#activeTex === evicted) {
          this.#activeTex = null;
          this.#activeInk = undefined;
        }
      });
    } else {
      this.#budget.touch('layer:active');
    }

    // Below / above chunked layers keyed by exact stroke + look identity.
    const inkOfGroup = (list: { cell: Frame; look: LayerLook }[]): unknown[] => {
      const sig: unknown[] = [w, h, scene.viewport.scale, scene.viewport.dpr];
      for (const item of list) {
        sig.push(item.look.opacity, item.look.blend, item.cell.strokes.length);
        for (const s of item.cell.strokes) {
          sig.push(s.points, scene.tools[s.tool_id], s.pressure, (s as PlacedStroke).place);
        }
      }
      return sig;
    };

    const nextBelowInk = inkOfGroup(below);
    const belowDirty = !this.#belowComplete || !sameStrokeList(this.#belowInk, nextBelowInk);
    let belowPlan = belowDirty
      ? this.#acquireLayerGroupTargets('below', below, w, h, this.#belowChunks)
      : null;

    const nextAboveInk = inkOfGroup(above);
    const aboveDirty = !this.#aboveComplete || !sameStrokeList(this.#aboveInk, nextAboveInk);
    const abovePlan = aboveDirty
      ? this.#acquireLayerGroupTargets('above', above, w, h, this.#aboveChunks)
      : null;

    // If allocating `above` evicted a `below` chunk we just prepared, release the
    // remainder of `below` so `#composeFrame` streams it cleanly without dangling textures.
    if (belowPlan && belowPlan.targets.length > 0 && this.#evictedBelow) {
      for (let k = 0; k < belowPlan.targets.length; k++) {
        this.#budget.release(`chunk:below:${k}`);
      }
      belowPlan = { targets: [], complete: false };
    }

    // Single pre-draw allocation error check for core + active + below + above.
    if (this.#needsErrorCheck && !this.#checkHealthy()) {
      return false;
    }

    // Phase 2: Rasterize into the already-validated stack targets.
    if (this.#activeTex) {
      if (!sameStrokeList(this.#activeInk, nextInk)) {
        // Incremental append fast path when strokes were only appended at the end.
        const prev = this.#activeInk;
        const canAppend = prev !== undefined
          && prev.length < nextInk.length
          && prev.every((v, i) => v === nextInk[i])
          && !extendsFlatRun(activeVisible.strokes, prev.length / 4, scene.tools);
        if (canAppend) {
          this.#renderCellStrokes(
            { strokes: activeVisible.strokes.slice(prev.length / 4) },
            scene.tools,
            scene.viewport,
            this.#activeTex,
            false,
          );
        } else if (
          prev !== undefined
          && this.#repaintTaken(this.#activeTex, activeVisible, prev, nextInk, scene, w, h)
        ) {
          // Scissored region undo handled in place.
        } else {
          this.#clearTarget(this.#activeTex, 0, 0, 0, 0);
          this.#renderCellStrokes(activeVisible, scene.tools, scene.viewport, this.#activeTex, false);
        }
        this.#activeInk = nextInk;
      }
    } else {
      this.#activeInk = undefined;
    }

    if (belowPlan) {
      const res = this.#rasterizePreparedGroup(below, belowPlan, scene);
      this.#belowChunks = res.chunks;
      this.#belowComplete = res.complete;
      this.#belowInk = res.complete ? nextBelowInk : undefined;
    }

    if (abovePlan) {
      const res = this.#rasterizePreparedGroup(above, abovePlan, scene);
      this.#aboveChunks = res.chunks;
      this.#aboveComplete = res.complete;
      this.#aboveInk = res.complete ? nextAboveInk : undefined;
    }

    if (this.#gl.isContextLost()) {
      this.#lastFailure = 'context-lost';
      this.dispose();
      return false;
    }
    return true;
  }

  #releaseChunks(prefix: string, chunks: LayerChunkTex[]): void {
    const count = chunks.length;
    chunks.length = 0;
    if (prefix === 'below') this.#belowComplete = false;
    else this.#aboveComplete = false;
    for (let i = 0; i < count; i++) {
      this.#budget.release(`chunk:${prefix}:${i}`);
    }
  }

  #acquireLayerGroupTargets(
    prefix: 'below' | 'above',
    entries: readonly { cell: Frame; look: LayerLook }[],
    w: number,
    h: number,
    existing: LayerChunkTex[],
  ): { targets: TextureTarget[]; complete: boolean } {
    if (entries.length === 0) {
      this.#releaseChunks(prefix, existing);
      return { targets: [], complete: true };
    }

    // Compute total chunk count up front so we NEVER evict an earlier chunk of
    // this same group while building later chunks (F1).
    let neededChunks = 0;
    for (let k = 0; k < entries.length; ) {
      neededChunks++;
      if (entries[k].look.blend) {
        k++;
      } else {
        while (k < entries.length && !entries[k].look.blend) k++;
      }
    }
    const neededBytes = neededChunks * sheetTextureBytes(w, h, false);
    if (neededBytes > this.#budget.headroom) {
      this.#releaseChunks(prefix, existing);
      return { targets: [], complete: false };
    }

    // Reuse existing retained chunk targets of matching dimensions so frame
    // switches never destroy/reallocate GPU textures or trigger gl.getError() IPC.
    const reusable: TextureTarget[] = [];
    if (existing.length > 0 && existing.every((c) => c.target.width === w && c.target.height === h)) {
      for (let k = neededChunks; k < existing.length; k++) {
        this.#budget.release(`chunk:${prefix}:${k}`);
      }
      const keep = Math.min(existing.length, neededChunks);
      for (let k = 0; k < keep; k++) {
        this.#budget.touch(`chunk:${prefix}:${k}`);
        reusable.push(existing[k].target);
      }
    } else {
      this.#releaseChunks(prefix, existing);
    }

    if (prefix === 'below') this.#evictedBelow = false;
    else this.#evictedAbove = false;

    const onEvictChunk = (): void => {
      if (prefix === 'below') {
        this.#evictedBelow = true;
        this.#belowChunks = [];
        this.#belowComplete = false;
        this.#belowInk = undefined;
      } else {
        this.#evictedAbove = true;
        this.#aboveChunks = [];
        this.#aboveComplete = false;
        this.#aboveInk = undefined;
      }
    };
    const abortPartial = (allocated: number): { targets: TextureTarget[]; complete: boolean } => {
      const total = Math.max(reusable.length, allocated);
      for (let k = 0; k < total; k++) {
        this.#budget.release(`chunk:${prefix}:${k}`);
      }
      return { targets: [], complete: false };
    };

    const targets: TextureTarget[] = [];
    for (let k = 0; k < neededChunks; k++) {
      const target = k < reusable.length
        ? reusable[k]
        : this.#retainLayerTarget(`chunk:${prefix}:${k}`, w, h, onEvictChunk);
      const evictedSelf = prefix === 'below' ? this.#evictedBelow : this.#evictedAbove;
      if (!target || evictedSelf) return abortPartial(k + 1);
      targets.push(target);
    }
    return { targets, complete: true };
  }

  #rasterizePreparedGroup(
    entries: readonly { cell: Frame; look: LayerLook }[],
    plan: { targets: TextureTarget[]; complete: boolean },
    scene: FrameScene,
  ): { chunks: LayerChunkTex[]; complete: boolean } {
    if (!plan.complete || plan.targets.length === 0) {
      return { chunks: [], complete: plan.complete };
    }
    const out: LayerChunkTex[] = [];
    // Group plain/translucent layers together; isolate each blended layer in its own chunk.
    let i = 0;
    let idx = 0;
    while (i < entries.length) {
      if (entries[i].look.blend) {
        const target = plan.targets[idx++];
        this.#clearTarget(target, 0, 0, 0, 0);
        if (entries[i].cell.strokes.length > 0) {
          this.#renderCellStrokes(entries[i].cell, scene.tools, scene.viewport, target, false);
        }
        out.push({ target, look: entries[i].look, ink: entries[i].cell.strokes.length > 0 });
        i++;
        continue;
      }
      const run: { cell: Frame; look: LayerLook }[] = [];
      while (i < entries.length && !entries[i].look.blend) {
        run.push(entries[i]);
        i++;
      }
      const target = plan.targets[idx++];
      this.#clearTarget(target, 0, 0, 0, 0);
      let anyInk = false;
      for (let r = 0; r < run.length; r++) {
        const { cell, look } = run[r];
        if (cell.strokes.length === 0) continue;
        anyInk = true;
        const needsIsolate = hasLook(look) || (r > 0 && hasEraser(cell, scene.tools));
        if (!needsIsolate) {
          this.#renderCellStrokes(cell, scene.tools, scene.viewport, target, false);
        } else if (this.#slotB) {
          this.#clearTarget(this.#slotB, 0, 0, 0, 0);
          this.#renderCellStrokes(cell, scene.tools, scene.viewport, this.#slotB, false);
          this.#blitTex(this.#slotB.tex, target, (look.opacity ?? 100) / 100, null, true);
        }
      }
      out.push({ target, look: undefined, ink: anyInk });
    }
    return { chunks: out, complete: true };
  }

  #composeFrame(scene: FrameScene, w: number, h: number, hasGhosts: boolean): boolean {
    if (this.#needsErrorCheck && !this.#checkHealthy()) {
      return false;
    }
    const slotA = this.#slotA!;
    const slotB = this.#slotB!;
    const usePaper = !scene.blend && scene.paper !== undefined && showsBlend(scene);

    // Prepare pinned `#under` ghost composite if ghosts are shown (rebuilt only on ghost/stroke change).
    if (hasGhosts && this.#underTex && scene.ghosts) {
      const ghostInk: unknown[] = [w, h, scene.viewport.scale, scene.viewport.dpr];
      for (const g of scene.ghosts.frames) {
        ghostInk.push(g.index, g.alpha, g.tint ?? '');
        for (const l of scene.ghosts.layers) {
          const layer = scene.doc.layers[l];
          const cell = layer && g.index < layer.frames.length ? resolveCell(layer, g.index) : undefined;
          if (!cell || layer.hidden || cell.strokes.length === 0) continue;
          ghostInk.push(l, cell.strokes.length);
          for (const s of cell.strokes) {
            ghostInk.push(s.points, scene.doc.tools[s.tool_id], s.pressure);
          }
        }
      }
      if (!sameStrokeList(this.#underInk, ghostInk)) {
        this.#renderGhostsInto(scene, scene.ghosts.frames, scene.ghosts.layers, this.#underTex, w, h);
        this.#underInk = ghostInk;
      }
    }

    // Initialize slotA (transparent or paper when any layer uses a blend mode).
    if (usePaper && scene.paper) {
      const [pr, pg, pb] = parseHexRgb(scene.paper);
      this.#clearTarget(slotA, pr, pg, pb, 1);
    } else {
      this.#clearTarget(slotA, 0, 0, 0, 0);
    }

    const layLayerTex = (srcTex: WebGLTexture, look: LayerLook | undefined): void => {
      if (look?.blend) {
        const prog = this.#ensureBlendProgram();
        if (prog) {
          // Ping-pong: copy slotA -> free backdrop slot (slotC if srcTex already occupies slotB),
          // then blend srcTex over backdrop into slotA without overwriting srcTex.
          const backdrop = srcTex === slotB.tex ? this.#slotC! : slotB;
          this.#blitTex(slotA.tex, backdrop, 1, null, false);
          this.#blendTex(backdrop.tex, srcTex, slotA, (look.opacity ?? 100) / 100, look.blend, prog);
          return;
        }
      }
      this.#blitTex(srcTex, slotA, (look?.opacity ?? 100) / 100, null, true);
    };

    // 1. Layers below active.
    if (this.#belowComplete) {
      for (const chunk of this.#belowChunks) {
        if (chunk.ink) layLayerTex(chunk.target.tex, chunk.look);
      }
    } else {
      // Streaming path when retained headroom could not hold all below chunks.
      for (let l = 0; l < scene.activeLayer; l++) {
        const layer = scene.doc.layers[l];
        const cell = this.#cell(scene, l);
        if (!cell || layer.hidden || cell.strokes.length === 0) continue;
        this.#clearTarget(slotB, 0, 0, 0, 0);
        this.#renderCellStrokes(cell, scene.tools, scene.viewport, slotB, false);
        layLayerTex(slotB.tex, hasLook(layer) ? layer : undefined);
      }
    }

    // 2. Ghosts between below and active (unless `scene.blend` puts ghosts under the whole frame).
    if (hasGhosts && this.#underTex && !scene.blend) {
      this.#blitTex(this.#underTex.tex, slotA, 1, null, true);
    }

    // 3. Active layer + live line.
    const activeCell = this.#cell(scene, scene.activeLayer);
    const ownLayer = scene.doc.layers[scene.activeLayer];
    const activeVisible = activeCell && !ownLayer?.hidden;
    if (activeVisible) {
      const hasLive = Boolean(scene.live);
      if (this.#activeTex && !hasLive) {
        layLayerTex(this.#activeTex.tex, this.#activeLook);
      } else {
        // Assemble active + live stroke into slotB, then lay with activeLook.
        this.#clearTarget(slotB, 0, 0, 0, 0);
        if (this.#activeTex && !scene.live?.flat) {
          this.#blitTex(this.#activeTex.tex, slotB, 1, null, false);
          if (scene.live) this.#renderLiveStroke(scene.live, activeCell, scene, slotB);
        } else if (scene.live?.flat) {
          this.#renderActiveWithLiveFlatCoat(scene.live, activeCell, scene, slotB);
        } else {
          this.#renderCellStrokes(activeCell, scene.tools, scene.viewport, slotB, false);
          if (scene.live) this.#renderLiveStroke(scene.live, activeCell, scene, slotB);
        }
        layLayerTex(slotB.tex, this.#activeLook);
      }
    }

    // 4. Layers above active.
    if (this.#aboveComplete) {
      for (const chunk of this.#aboveChunks) {
        if (chunk.ink) layLayerTex(chunk.target.tex, chunk.look);
      }
    } else {
      for (let l = scene.activeLayer + 1; l < scene.doc.layers.length; l++) {
        const layer = scene.doc.layers[l];
        const cell = this.#cell(scene, l);
        if (!cell || layer.hidden || cell.strokes.length === 0) continue;
        this.#clearTarget(slotB, 0, 0, 0, 0);
        this.#renderCellStrokes(cell, scene.tools, scene.viewport, slotB, false);
        layLayerTex(slotB.tex, hasLook(layer) ? layer : undefined);
      }
    }

    // 5. Whole-frame alpha (`scene.alpha < 1`, e.g. onion blend mode).
    const frameAlpha = scene.alpha ?? 1;
    if (frameAlpha < 1) {
      this.#blitTex(slotA.tex, slotB, 1, null, false);
      this.#clearTarget(slotA, 0, 0, 0, 0);
      if (hasGhosts && this.#underTex && scene.blend) {
        this.#blitTex(this.#underTex.tex, slotA, 1, null, true);
      }
      this.#blitTex(slotB.tex, slotA, frameAlpha, null, true);
    }

    // Update mipmaps for high-quality minification when `stretch < 1`.
    // When storage is mutable (`texImage2D` fallback), `generateMipmap` can allocate/redefine levels.
    if (slotA.mipmapped) {
      const gl = this.#gl;
      if (!slotA.immutableMips) this.#needsErrorCheck = true;
      gl.bindTexture(gl.TEXTURE_2D, slotA.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }

    if (this.#gl.isContextLost()) {
      this.#lastFailure = 'context-lost';
      this.dispose();
      return false;
    }
    return true;
  }

  #renderGhostsInto(
    scene: FrameScene,
    ghosts: readonly GhostFrame[],
    layerIndices: readonly number[],
    dst: TextureTarget,
    _w: number,
    _h: number,
  ): void {
    // Called before slotA is initialized, so slotA is free for eraser-isolated ghost
    // cells while slotC remains reserved exclusively for flat-coat masks.
    const slotA = this.#slotA!;
    const slotB = this.#slotB!;
    this.#clearTarget(dst, 0, 0, 0, 0);
    for (const ghost of ghosts) {
      this.#clearTarget(slotB, 0, 0, 0, 0);
      let any = false;
      for (const l of layerIndices) {
        const layer = scene.doc.layers[l];
        const cell = layer && ghost.index < layer.frames.length ? resolveCell(layer, ghost.index) : undefined;
        if (!cell || layer.hidden || cell.strokes.length === 0) continue;
        any = true;
        if (hasEraser(cell, scene.doc.tools)) {
          this.#clearTarget(slotA, 0, 0, 0, 0);
          this.#renderCellStrokes(cell, scene.doc.tools, scene.viewport, slotA, false);
          this.#blitTex(slotA.tex, slotB, 1, null, true);
        } else {
          this.#renderCellStrokes(cell, scene.doc.tools, scene.viewport, slotB, false);
        }
      }
      if (!any) continue;
      const tint = ghost.tint ? parseHexRgb(ghost.tint) : null;
      this.#blitTex(slotB.tex, dst, ghost.alpha, tint, true);
    }
  }

  #renderActiveWithLiveFlatCoat(live: LiveLine, cell: Frame, scene: FrameScene, dst: TextureTarget): void {
    const tool = live.flat!;
    const strokes = cell.strokes;
    let start = strokes.length;
    while (start > 0 && sameFlatPaint(tool, scene.tools[strokes[start - 1].tool_id])) start--;
    if (start > 0) {
      this.#renderCellStrokes({ strokes: strokes.slice(0, start) }, scene.tools, scene.viewport, dst, false);
    }
    const mask = this.#slotC!;
    this.#clearTarget(mask, 0, 0, 0, 0);
    if (start < strokes.length) {
      this.#renderCellStrokes({ strokes: strokes.slice(start) }, scene.tools, scene.viewport, mask, true);
    }
    this.#renderLiveStroke(live, cell, scene, mask, true);
    this.#blitTex(mask.tex, dst, tool.opacity / 100, null, true);
  }

  #renderLiveStroke(
    live: LiveLine,
    _cell: Frame,
    scene: FrameScene,
    dst: TextureTarget,
    opaqueOverride = false,
  ): void {
    const k = scene.viewport.scale * scene.viewport.dpr;
    const rasterLevel = k * FIXED_POINT_SCALE;
    const ops: PaintOp[] = [];
    let nextId = 0;

    if (live.spec) {
      if (live.spec.kind === 'raw-polyline') {
        const mesh = tessellateLivePolyline(
          live.spec.points,
          'line',
          live.spec.width,
          rasterLevel,
          live.spec.fill !== undefined,
        );
        const tool: ToolDescriptor = live.spec.fill !== undefined
          ? { kind: 'feather', geometry: 'line', width: live.spec.width, color: live.spec.color, fill: live.spec.fill }
          : { kind: live.erase ? 'eraser' : 'pencil', geometry: 'line', width: live.spec.width, color: live.spec.color } as ToolDescriptor;
        const effAlpha = opaqueOverride ? 1 : (live.spec.alpha ?? 1);
        this.#pushMeshOps(ops, () => nextId++, mesh, { points: [...live.spec.points], tool_id: 0 }, tool, 0, effAlpha, Boolean(live.erase), scene.viewport, null);
      } else {
        const { points, tool, color, pressure, alpha } = live.spec;
        const effectiveTool: ToolDescriptor = 'color' in tool ? { ...tool, color } : tool;
        const mesh = tessellateStroke(points, effectiveTool, rasterLevel, pressure);
        const effAlpha = opaqueOverride ? 1 : alpha;
        this.#pushMeshOps(ops, () => nextId++, mesh, { points: [...points], tool_id: 0, pressure: pressure ? [...pressure] : undefined }, effectiveTool, 0, effAlpha, Boolean(live.erase) || isEraserTool(tool), scene.viewport, null);
      }
    } else if (live.points && live.points.length >= 2) {
      const tool: ToolDescriptor = {
        kind: live.erase ? 'eraser' : 'pencil',
        geometry: live.geometry ?? 'smooth',
        width: live.width ?? 1,
        color: live.color ?? '#000000',
      } as ToolDescriptor;
      const mesh = tessellateStroke(live.points, tool, rasterLevel);
      this.#pushMeshOps(ops, () => nextId++, mesh, { points: [...live.points], tool_id: 0 }, tool, 0, 1, Boolean(live.erase), scene.viewport, null);
    }

    if (ops.length > 0) {
      this.#executePaintOps(ops, dst, scene.viewport, null);
    }
  }

  /**
   * Scissored region undo on `#activeTex`, matching `frame-compose.ts` `repaintTaken`
   * including the exact `isFlatPaint` guard (removing a separator can join two
   * flat coats elsewhere on the sheet).
   */
  #repaintTaken(
    dst: TextureTarget,
    cell: Frame,
    was: readonly unknown[],
    now: readonly unknown[],
    scene: FrameScene,
    width: number,
    height: number,
  ): boolean {
    if (now.length >= was.length) return false;
    // Flat-coat guard: removing any separator can merge coats elsewhere.
    // Lasso `place` guard: deleting or moving placed strokes invalidates
    // transformed bounds, so fall back to a full active-layer rebuild.
    for (let i = 0; i < was.length; i += 4) {
      if (isFlatPaint(was[i + 1] as ToolDescriptor | undefined)) return false;
      if (was[i + 3] !== undefined) return false;
    }
    for (let i = 0; i < now.length; i += 4) {
      if (now[i + 3] !== undefined) return false;
    }
    const reach = (points: readonly number[], tool: unknown): [number, number, number, number] => {
      const pad = (tool as { width?: number } | undefined)?.width ?? 0;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let p = 0; p < points.length; p += 2) {
        if (points[p] < minX) minX = points[p];
        if (points[p] > maxX) maxX = points[p];
        if (points[p + 1] < minY) minY = points[p + 1];
        if (points[p + 1] > maxY) maxY = points[p + 1];
      }
      return [minX - pad, minY - pad, maxX + pad, maxY + pad];
    };
    let j = 0;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < was.length; i += 4) {
      if (
        j < now.length
        && was[i] === now[j]
        && was[i + 1] === now[j + 1]
        && was[i + 2] === now[j + 2]
        && was[i + 3] === now[j + 3]
      ) {
        j += 4;
        continue;
      }
      const [a, b, c, d] = reach(was[i] as readonly number[], was[i + 1]);
      if (a < x0) x0 = a;
      if (b < y0) y0 = b;
      if (c > x1) x1 = c;
      if (d > y1) y1 = d;
    }
    if (j !== now.length || !Number.isFinite(x0)) return false;

    const { viewport } = scene;
    const k = viewport.scale * viewport.dpr;
    const ox = (viewport.panX ?? 0) * viewport.dpr;
    const oy = (viewport.panY ?? 0) * viewport.dpr;
    const left = Math.max(0, Math.floor(x0 * k + ox) - 2);
    const top = Math.max(0, Math.floor(y0 * k + oy) - 2);
    const right = Math.min(width, Math.ceil(x1 * k + ox) + 2);
    const bottom = Math.min(height, Math.ceil(y1 * k + oy) + 2);
    if (right <= left || bottom <= top) return true;
    const rw = right - left;
    const rh = bottom - top;
    if (rw * rh > (width * height) / 2) return false;

    const touching = cell.strokes.filter((s) => {
      const [a, b, c, d] = reach(s.points, scene.tools[s.tool_id]);
      return a * k + ox < right && c * k + ox > left && b * k + oy < bottom && d * k + oy > top;
    });

    const gl = this.#gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, width, height);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(left, top, rw, rh);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (touching.length > 0) {
      this.#renderCellStrokes({ strokes: touching }, scene.tools, viewport, dst, false, [left, top, rw, rh]);
    }
    return true;
  }

  #renderCellStrokes(
    cell: Frame,
    tools: readonly ToolDescriptor[],
    viewport: FrameScene['viewport'],
    dst: TextureTarget,
    opaqueRun: boolean,
    clipRect: readonly [number, number, number, number] | null = null,
  ): void {
    if (cell.strokes.length === 0) return;
    const k = viewport.scale * viewport.dpr;
    const rasterLevel = k * FIXED_POINT_SCALE;

    // Detect if any stroke in this cell carries a rigid lasso `place` matrix.
    let placeMatrix: readonly number[] | null = null;
    for (const s of cell.strokes) {
      const p = (s as PlacedStroke).place;
      if (p) { placeMatrix = p; break; }
    }

    const mask = this.#slotC!;
    let opId = 0;
    const nextId = () => opId++;

    let i = 0;
    while (i < cell.strokes.length) {
      const stroke = cell.strokes[i] as PlacedStroke;
      const tool = resolveTool(tools, stroke);

      // Flat-coat run (`buildup: false`): accumulate opaque into #mask, composite once at opacity.
      if (!opaqueRun && isFlatPaint(tool) && (extendsFlatRun(cell.strokes, i + 1, tools) || hasInteriorPaint(tool, stroke.points))) {
        let end = i + 1;
        while (extendsFlatRun(cell.strokes, end, tools)) end++;
        this.#clearTarget(mask, 0, 0, 0, 0);
        this.#renderCellStrokes({ strokes: cell.strokes.slice(i, end) }, tools, viewport, mask, true);
        this.#blitTex(mask.tex, dst, tool.opacity / 100, null, true);
        i = end;
        continue;
      }

      // Collect consecutive non-flat strokes sharing the same composite mode (`source-over` vs `destination-out`).
      const erase = isEraserTool(tool);
      const runOps: PaintOp[] = [];
      while (i < cell.strokes.length) {
        const cur = cell.strokes[i] as PlacedStroke;
        const curTool = resolveTool(tools, cur);
        if (!opaqueRun && isFlatPaint(curTool) && (extendsFlatRun(cell.strokes, i + 1, tools) || hasInteriorPaint(curTool, cur.points))) {
          break;
        }
        if (isEraserTool(curTool) !== erase) {
          break;
        }
        const mesh = this.#meshes.take(cur.points, curTool, rasterLevel, cur.pressure, () =>
          tessellateStroke(cur.points, curTool, rasterLevel, cur.pressure),
        );
        const opAlpha = opaqueRun ? 1 : (opacityOf(curTool).opacity ?? 100) / 100;
        const matIdx: 0 | 1 = cur.place ? 1 : 0;
        this.#pushMeshOps(runOps, nextId, mesh, cur, curTool, matIdx, opAlpha, erase, viewport, cur.place ?? null);
        i++;
      }

      if (runOps.length > 0) {
        this.#executePaintOps(runOps, dst, viewport, placeMatrix, clipRect);
      }
    }
  }

  #pushMeshOps(
    out: PaintOp[],
    nextId: () => number,
    mesh: StrokeMesh,
    stroke: PlacedStroke,
    tool: ToolDescriptor,
    matIndex: 0 | 1,
    alpha: number,
    erase: boolean,
    viewport: FrameScene['viewport'],
    place: readonly number[] | null,
  ): void {
    const k = viewport.scale * viewport.dpr;
    const ox = (viewport.panX ?? 0) * viewport.dpr;
    const oy = (viewport.panY ?? 0) * viewport.dpr;
    const m: [number, number, number, number, number, number] = place
      ? [k * place[0], k * place[1], k * place[2], k * place[3], k * place[4] + ox, k * place[5] + oy]
      : [k, 0, 0, k, ox, oy];
    const [minX, minY, maxX, maxY] = transformBounds(mesh.bounds, m);

    if (mesh.fallbackReason) {
      out.push({
        id: nextId(),
        minX, minY, maxX, maxY,
        mode: 'reference',
        vertices: new Float32Array(0),
        matIndex,
        color: parseHexRgb(toolColorHex(tool)),
        alpha,
        erase,
        refStroke: stroke,
        refTool: tool,
      });
      return;
    }

    if (isFilledLineTool(tool) && mesh.interiorVertices.length > 0) {
      out.push({
        id: nextId(),
        minX, minY, maxX, maxY,
        mode: 'nonzero',
        vertices: mesh.interiorVertices,
        matIndex,
        color: parseHexRgb(tool.fill),
        alpha,
        erase: false,
      });
    }

    const verts = mesh.mode === 'union' ? mesh.unionVertices : mesh.fillVertices;
    if (verts.length > 0) {
      out.push({
        id: nextId(),
        minX, minY, maxX, maxY,
        mode: mesh.mode,
        vertices: verts,
        matIndex,
        color: parseHexRgb(toolColorHex(tool)),
        alpha,
        erase,
      });
    }
  }

  #executePaintOps(
    ops: readonly PaintOp[],
    dst: TextureTarget,
    viewport: FrameScene['viewport'],
    placeMatrix: readonly number[] | null,
    clipRect: readonly [number, number, number, number] | null = null,
  ): void {
    const atlas = this.#atlas!;
    const k = viewport.scale * viewport.dpr;
    const ox = (viewport.panX ?? 0) * viewport.dpr;
    const oy = (viewport.panY ?? 0) * viewport.dpr;

    const matrices = this.#matrices;
    writeAffineMat3(matrices, 0, k, 0, 0, k, ox, oy);
    if (placeMatrix) {
      writeAffineMat3(
        matrices, 9,
        k * placeMatrix[0], k * placeMatrix[1],
        k * placeMatrix[2], k * placeMatrix[3],
        k * placeMatrix[4] + ox, k * placeMatrix[5] + oy,
      );
    } else {
      writeAffineMat3(matrices, 9, k, 0, 0, k, ox, oy);
    }

    // Split reference-mask ops cleanly so exact stroke order is preserved.
    let i = 0;
    while (i < ops.length) {
      if (ops[i].mode === 'reference') {
        this.#compositeReferenceOp(ops[i], dst, viewport, clipRect);
        i++;
        continue;
      }
      const gpuOps: PaintOp[] = [];
      while (i < ops.length && ops[i].mode !== 'reference') {
        gpuOps.push(ops[i]);
        i++;
      }
      const batches = planAtlasBatches(gpuOps, atlas.logicalSide, dst.width, dst.height);
      for (const batch of batches) {
        this.#runAtlasBatch(batch, dst, matrices, clipRect);
      }
    }
  }

  #runAtlasBatch(
    batch: ReturnType<typeof planAtlasBatches<PaintOp>>[number],
    dst: TextureTarget,
    matrices: Float32Array,
    clipRect: readonly [number, number, number, number] | null = null,
  ): void {
    const gl = this.#gl;
    const atlas = this.#atlas!;
    const ss = atlas.supersample;

    // 1. Clear atlas color + stencil explicitly (never rely on invalidated stencil).
    gl.bindFramebuffer(gl.FRAMEBUFFER, atlas.fbo);
    gl.viewport(0, 0, atlas.physSide, atlas.physSide);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    if (batch.tiled) {
      const s = batch.slots[0];
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, 0, s.w * ss, s.h * ss);
    } else {
      gl.disable(gl.SCISSOR_TEST);
    }
    gl.colorMask(true, true, true, true);
    gl.stencilMask(0xff);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    // 2. Partition batch slots into union writes and nonzero stencil-then-cover writes.
    let unionFloats = 0;
    let nonzeroFloats = 0;
    let nonzeroCount = 0;
    for (const slot of batch.slots) {
      const count = slot.op.vertices.length / 2;
      if (slot.op.mode === 'union') unionFloats += count * 5;
      else {
        nonzeroFloats += count * 5;
        nonzeroCount++;
      }
    }

    const bindCovProgram = (): void => {
      const locs = this.#covLocs!;
      gl.useProgram(this.#covProg!);
      gl.uniformMatrix3fv(locs.uMatrices, false, matrices);
      gl.uniform1f(locs.uSupersample, ss);
      gl.uniform1f(locs.uAtlasPhys, atlas.physSide);
    };

    const maxVboBytes = vboBudgetForTier(this.#budget.budget);
    // Coverage vertex = 5 floats (20 bytes); triangle = 3 vertices (15 floats = 60 bytes).
    const maxCovFloats = Math.max(15, Math.floor(maxVboBytes / 60) * 15);

    const uploadAndDraw = (floatsCount: number): void => {
      if (floatsCount === 0) return;
      const offset = this.#uploadStream(floatsCount);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, offset);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, offset + 8);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 20, offset + 16);
      gl.drawArrays(gl.TRIANGLES, 0, floatsCount / 5);
    };

    // Streams coverage triangles in bounded chunks <= vboBudgetForTier via the
    // reused scratch buffer + WebGL2 bufferSubData (zero per-batch Float32Array
    // or subarray() allocations).
    const drawCoverageChunked = (mode: 'union' | 'nonzero', totalFloats: number): void => {
      const cap = Math.min(totalFloats, maxCovFloats);
      const buf = this.#ensureStreamScratch(cap);
      gl.enableVertexAttribArray(0);
      gl.enableVertexAttribArray(1);
      gl.enableVertexAttribArray(2);
      let o = 0;
      for (const slot of batch.slots) {
        if (slot.op.mode !== mode) continue;
        const dx = slot.atlasX - slot.sheetX;
        const dy = slot.atlasY - slot.sheetY;
        const verts = slot.op.vertices;
        const mat = slot.op.matIndex;
        // Step triangle-by-triangle (6 xy floats = 3 vertices = 15 output floats)
        // so chunk boundaries never split a triangle.
        for (let k = 0; k + 5 < verts.length; k += 6) {
          if (o + 15 > cap) {
            uploadAndDraw(o);
            o = 0;
          }
          buf[o++] = verts[k]; buf[o++] = verts[k + 1]; buf[o++] = dx; buf[o++] = dy; buf[o++] = mat;
          buf[o++] = verts[k + 2]; buf[o++] = verts[k + 3]; buf[o++] = dx; buf[o++] = dy; buf[o++] = mat;
          buf[o++] = verts[k + 4]; buf[o++] = verts[k + 5]; buf[o++] = dx; buf[o++] = dy; buf[o++] = mat;
        }
      }
      if (o > 0) {
        uploadAndDraw(o);
      }
      gl.disableVertexAttribArray(0);
      gl.disableVertexAttribArray(1);
      gl.disableVertexAttribArray(2);
    };

    if (unionFloats > 0) {
      gl.disable(gl.STENCIL_TEST);
      bindCovProgram();
      drawCoverageChunked('union', unionFloats);
    }

    if (nonzeroFloats > 0) {
      // Stencil winding pass (commutative & associative across bounded chunks).
      gl.enable(gl.STENCIL_TEST);
      gl.colorMask(false, false, false, false);
      gl.stencilFunc(gl.ALWAYS, 0, 0xff);
      gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.INCR_WRAP);
      gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.DECR_WRAP);
      bindCovProgram();
      drawCoverageChunked('nonzero', nonzeroFloats);

      // Cover pass into R8 atlas (chunked within VBO cap: 12 floats = 48 bytes per slot).
      const maxCoverSlots = Math.max(1, Math.floor(maxVboBytes / 48));
      const coverCap = Math.min(nonzeroCount, maxCoverSlots) * 12;
      const coverBuf = this.#ensureStreamScratch(coverCap);
      gl.colorMask(true, true, true, true);
      gl.stencilFunc(gl.NOTEQUAL, 0, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      gl.useProgram(this.#coverQuadProg!);
      gl.uniform1f(this.#coverLocs!.uAtlasPhys, atlas.physSide);
      gl.enableVertexAttribArray(0);

      let co = 0;
      const flushCover = (): void => {
        if (co === 0) return;
        const offset = this.#uploadStream(co);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, offset);
        gl.drawArrays(gl.TRIANGLES, 0, co / 2);
        co = 0;
      };
      for (const slot of batch.slots) {
        if (slot.op.mode !== 'nonzero') continue;
        if (co + 12 > coverCap) flushCover();
        const px0 = slot.atlasX * ss;
        const py0 = slot.atlasY * ss;
        const px1 = (slot.atlasX + slot.w) * ss;
        const py1 = (slot.atlasY + slot.h) * ss;
        coverBuf[co++] = px0; coverBuf[co++] = py0;
        coverBuf[co++] = px1; coverBuf[co++] = py0;
        coverBuf[co++] = px1; coverBuf[co++] = py1;
        coverBuf[co++] = px0; coverBuf[co++] = py0;
        coverBuf[co++] = px1; coverBuf[co++] = py1;
        coverBuf[co++] = px0; coverBuf[co++] = py1;
      }
      flushCover();
      gl.disableVertexAttribArray(0);
      gl.disable(gl.STENCIL_TEST);
    }

    if (batch.tiled) gl.disable(gl.SCISSOR_TEST);

    // 3. Composite all batch slots in exact original order onto 1x RGBA8 layer texture.
    const erase = batch.slots[0].op.erase;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.width, dst.height);
    if (clipRect) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(clipRect[0], clipRect[1], clipRect[2], clipRect[3]);
    } else {
      gl.disable(gl.SCISSOR_TEST);
    }
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    if (erase) {
      gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    const compLocs = this.#compLocs!;
    gl.useProgram(this.#compProg!);
    gl.uniform2f(compLocs.uDstSize, dst.width, dst.height);
    gl.uniform2f(compLocs.uMaskPhysSize, atlas.physSide, atlas.physSide);
    gl.uniform1i(compLocs.uSampleMode, ss === 2 ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlas.texture);
    gl.uniform1i(compLocs.uMask, 0);

    // 6 vertices * 8 floats = 48 floats (192 bytes) per composite slot.
    const maxCompSlots = Math.max(1, Math.floor(maxVboBytes / 192));
    const compCap = Math.min(batch.slots.length, maxCompSlots) * 48;
    const compData = this.#ensureStreamScratch(compCap);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.enableVertexAttribArray(2);
    let cp = 0;
    const flushComp = (): void => {
      if (cp === 0) return;
      const offset = this.#uploadStream(cp);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 32, offset);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, offset + 8);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, offset + 16);
      gl.drawArrays(gl.TRIANGLES, 0, cp / 8);
      cp = 0;
    };
    for (const slot of batch.slots) {
      if (cp + 48 > compCap) flushComp();
      const [r, g, b] = slot.op.color;
      const a = slot.op.alpha;
      const dx0 = slot.sheetX, dy0 = slot.sheetY;
      const dx1 = slot.sheetX + slot.w, dy1 = slot.sheetY + slot.h;
      const sx0 = slot.atlasX, sy0 = slot.atlasY;
      const sx1 = slot.atlasX + slot.w, sy1 = slot.atlasY + slot.h;
      compData[cp++] = dx0; compData[cp++] = dy0; compData[cp++] = sx0; compData[cp++] = sy0; compData[cp++] = r; compData[cp++] = g; compData[cp++] = b; compData[cp++] = a;
      compData[cp++] = dx1; compData[cp++] = dy0; compData[cp++] = sx1; compData[cp++] = sy0; compData[cp++] = r; compData[cp++] = g; compData[cp++] = b; compData[cp++] = a;
      compData[cp++] = dx1; compData[cp++] = dy1; compData[cp++] = sx1; compData[cp++] = sy1; compData[cp++] = r; compData[cp++] = g; compData[cp++] = b; compData[cp++] = a;
      compData[cp++] = dx0; compData[cp++] = dy0; compData[cp++] = sx0; compData[cp++] = sy0; compData[cp++] = r; compData[cp++] = g; compData[cp++] = b; compData[cp++] = a;
      compData[cp++] = dx1; compData[cp++] = dy1; compData[cp++] = sx1; compData[cp++] = sy1; compData[cp++] = r; compData[cp++] = g; compData[cp++] = b; compData[cp++] = a;
      compData[cp++] = dx0; compData[cp++] = dy1; compData[cp++] = sx0; compData[cp++] = sy1; compData[cp++] = r; compData[cp++] = g; compData[cp++] = b; compData[cp++] = a;
    }
    flushComp();
    gl.disableVertexAttribArray(0);
    gl.disableVertexAttribArray(1);
    gl.disableVertexAttribArray(2);
    if (clipRect) gl.disable(gl.SCISSOR_TEST);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * Bounded Canvas 2D native 1x1 reference path for subpixel (< 0.5 px)
   * strokes/slivers and >= 255 winding-overflow contours. Preserves full RGB
   * (including feather fill + outline), exact stroke opacity/erase semantics,
   * and tiles large bounds into `<= atlas.logicalSide` scratch tiles so live
   * GPU texture bytes stay strictly within `nativeFallbackTileBytes` (F8).
   */
  #compositeReferenceOp(
    op: PaintOp,
    dst: TextureTarget,
    viewport: FrameScene['viewport'],
    clipRect: readonly [number, number, number, number] | null = null,
  ): void {
    if (typeof document === 'undefined' || !op.refStroke || !op.refTool) return;
    const x0 = Math.max(0, Math.floor(op.minX) - 2);
    const y0 = Math.max(0, Math.floor(op.minY) - 2);
    const x1 = Math.min(dst.width, Math.ceil(op.maxX) + 2);
    const y1 = Math.min(dst.height, Math.ceil(op.maxY) + 2);
    if (x1 <= x0 || y1 <= y0) return;

    const tileSide = this.#atlas!.logicalSide;
    // Preserve per-pass opacity for buildup translucent strokes (e.g. feather outline
    // composited over translucent fill), while flat-coat mask runs pass `op.alpha === 1`
    // so both fill and outline accumulate opaque before single group-opacity compositing.
    const bakeToolOpacity = !op.erase && op.alpha < 1;
    const renderTool: ToolDescriptor = op.erase
      ? ({ ...op.refTool, kind: op.refTool.kind === 'contour-eraser' ? 'contour' : 'pencil', color: '#000000' } as ToolDescriptor)
      : bakeToolOpacity
        ? ({ ...op.refTool, opacity: op.alpha * 100, buildup: undefined } as ToolDescriptor)
        : ({ ...op.refTool, opacity: undefined, buildup: undefined } as ToolDescriptor);
    const blitAlpha = bakeToolOpacity ? 1 : op.alpha;
    const gl = this.#gl;

    for (let ty = y0; ty < y1; ty += tileSide) {
      const th = Math.min(tileSide, y1 - ty);
      for (let tx = x0; tx < x1; tx += tileSide) {
        const tw = Math.min(tileSide, x1 - tx);
        // Skip tiles completely outside an active region-undo clipRect.
        if (clipRect && (tx + tw <= clipRect[0] || tx >= clipRect[0] + clipRect[2] || ty + th <= clipRect[1] || ty >= clipRect[1] + clipRect[3])) {
          continue;
        }
        this.#refCanvas ??= document.createElement('canvas');
        if (this.#refCanvas.width !== tw) this.#refCanvas.width = tw;
        if (this.#refCanvas.height !== th) this.#refCanvas.height = th;
        const ctx = this.#refCanvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, tw, th);
        const shiftedViewport = {
          ...viewport,
          panX: (viewport.panX ?? 0) - tx / viewport.dpr,
          panY: (viewport.panY ?? 0) - ty / viewport.dpr,
        };
        renderStrokesLayer(
          { strokes: [{ ...op.refStroke, tool_id: 0 }] },
          [renderTool],
          ctx as unknown as Canvas2DLike,
          shiftedViewport,
        );
        const rgba = ctx.getImageData(0, 0, tw, th).data;
        let anyAlpha = false;
        const premul = new Uint8Array(rgba.length);
        for (let p = 0; p < rgba.length; p += 4) {
          const a = rgba[p + 3];
          if (a === 0) continue;
          anyAlpha = true;
          if (a === 255) {
            premul[p] = rgba[p];
            premul[p + 1] = rgba[p + 1];
            premul[p + 2] = rgba[p + 2];
            premul[p + 3] = 255;
          } else {
            premul[p] = Math.round((rgba[p] * a) / 255);
            premul[p + 1] = Math.round((rgba[p + 1] * a) / 255);
            premul[p + 2] = Math.round((rgba[p + 2] * a) / 255);
            premul[p + 3] = a;
          }
        }
        if (!anyAlpha) continue;

        this.#needsErrorCheck = true;
        const tex = this.#atlas!.uploadNativeRgba(premul, tw, th);
        if (!tex) return;

        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
        gl.viewport(tx, ty, tw, th);
        if (clipRect) {
          gl.enable(gl.SCISSOR_TEST);
          gl.scissor(clipRect[0], clipRect[1], clipRect[2], clipRect[3]);
        } else {
          gl.disable(gl.SCISSOR_TEST);
        }
        gl.disable(gl.STENCIL_TEST);
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFunc(op.erase ? gl.ZERO : gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        const blitLocs = this.#blitLocs!;
        gl.useProgram(this.#blitProg!);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(blitLocs.uTex, 0);
        gl.uniform1f(blitLocs.uAlpha, blitAlpha);
        gl.uniform1i(blitLocs.uTintMode, 0);
        gl.uniform2f(blitLocs.uUvOrigin, 0, 0);
        gl.uniform2f(blitLocs.uUvSpan, 1, 1);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.#quadVbo);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.disableVertexAttribArray(0);
        if (clipRect) gl.disable(gl.SCISSOR_TEST);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
    }
  }

  #clearTarget(target: TextureTarget, r: number, g: number, b: number, a: number): void {
    const gl = this.#gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.width, target.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.colorMask(true, true, true, true);
    gl.clearColor(r, g, b, a);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  #blitTex(
    srcTex: WebGLTexture,
    dst: TextureTarget,
    alpha: number,
    tint: [number, number, number] | null,
    blend: boolean,
  ): void {
    this.#blitSubRect(srcTex, dst, alpha, 0, 0, 1, 1, blend, tint);
  }

  #blitSubRect(
    srcTex: WebGLTexture,
    dst: TextureTarget,
    alpha: number,
    u0: number,
    v0: number,
    du: number,
    dv: number,
    blend: boolean,
    tint: [number, number, number] | null = null,
  ): void {
    const gl = this.#gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.width, dst.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    if (blend) {
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.disable(gl.BLEND);
    }
    const blitLocs = this.#blitLocs!;
    gl.useProgram(this.#blitProg!);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(blitLocs.uTex, 0);
    gl.uniform1f(blitLocs.uAlpha, alpha);
    gl.uniform1i(blitLocs.uTintMode, tint ? 1 : 0);
    if (tint) {
      gl.uniform3f?.(blitLocs.uTint, tint[0], tint[1], tint[2]);
    }
    gl.uniform2f(blitLocs.uUvOrigin, u0, v0);
    gl.uniform2f(blitLocs.uUvSpan, du, dv);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.#quadVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  #blendTex(
    dstTex: WebGLTexture,
    srcTex: WebGLTexture,
    out: TextureTarget,
    opacity: number,
    mode: BlendMode,
    prog: WebGLProgram,
    u0 = 0,
    v0 = 0,
    du = 1,
    dv = 1,
  ): void {
    const gl = this.#gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.viewport(0, 0, out.width, out.height);
    gl.disable(gl.BLEND);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.SCISSOR_TEST);
    const blendLocs = this.#blendLocs!;
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dstTex);
    gl.uniform1i(blendLocs.uDst, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(blendLocs.uSrc, 1);
    gl.uniform1f(blendLocs.uOpacity, opacity);
    gl.uniform1i(blendLocs.uMode, blendModeId(mode));
    gl.uniform2f(blendLocs.uUvOrigin, u0, v0);
    gl.uniform2f(blendLocs.uUvSpan, du, dv);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.#quadVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  #layChunkOnPick(
    srcTex: WebGLTexture,
    look: LayerLook | undefined,
    u0: number,
    v0: number,
    du: number,
    dv: number,
  ): void {
    if (!this.#pickTex) return;
    if (look?.blend) {
      const prog = this.#ensureBlendProgram();
      this.#pickScratch ??= createTarget(this.#gl, 1, 1, false);
      if (prog && this.#pickScratch) {
        this.#blitSubRect(this.#pickTex.tex, this.#pickScratch, 1, 0, 0, 1, 1, false);
        this.#blendTex(this.#pickScratch.tex, srcTex, this.#pickTex, (look.opacity ?? 100) / 100, look.blend, prog, u0, v0, du, dv);
        return;
      }
    }
    this.#blitSubRect(srcTex, this.#pickTex, (look?.opacity ?? 100) / 100, u0, v0, du, dv, true);
  }

  #presentSheet(sheet: TextureTarget, present: StagePresentParams): void {
    const gl = this.#gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, present.stageWidth, present.stageHeight);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sheet.tex);
    const magFilter = present.stretch >= 2 ? gl.NEAREST : gl.LINEAR;
    const minFilter = present.stretch >= 2
      ? gl.NEAREST
      : (present.stretch < 1 && sheet.mipmapped ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);

    const rad = (present.angle * Math.PI) / 180;
    const [pr, pg, pb] = parseHexRgb(present.paper);
    const presentLocs = this.#presentLocs!;
    gl.useProgram(this.#presentProg!);
    gl.uniform1i(presentLocs.uSheet, 0);
    gl.uniform2f(presentLocs.uStageSize, present.stageWidth, present.stageHeight);
    gl.uniform2f(presentLocs.uSheetOrigin, present.sheetX, present.sheetY);
    gl.uniform2f(presentLocs.uSheetSize, present.sheetW, present.sheetH);
    gl.uniform2f(presentLocs.uCosSin, Math.cos(rad), Math.sin(rad));
    gl.uniform3f?.(presentLocs.uPaper, pr, pg, pb);
    gl.uniform1f(presentLocs.uGridStep, present.gridStep);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.#unitQuadVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(0);
    // Restore base-level LINEAR filtering so future working passes never sample
    // an incomplete mip chain before the next `generateMipmap`.
    if (minFilter !== gl.LINEAR) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    if (magFilter !== gl.LINEAR) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
}
