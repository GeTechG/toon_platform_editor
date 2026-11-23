/**
 * Unified VRAM accounting, scene preflight, proactive eviction, and
 * OUT_OF_MEMORY generation poisoning for the studio WebGL2 renderer.
 *
 * Guarantees that retained caches (layers, ghosts, cells, playback frames) only
 * allocate from remaining headroom after required working surfaces (including a
 * pinned `#under` ghost buffer when onion skin is enabled so ghosts are never
 * recomputed on every live-stroke event — frame-rendering/spec.md:410).
 */

import type { AtlasFormats } from './probe';

const MB = 1024 * 1024;

/**
 * Computes the studio WebGL2 VRAM budget.
 *
 * Browsers that omit `navigator.deviceMemory` (Firefox, Waterfox, Safari)
 * would otherwise fall into the 64 MiB mobile tier (256x256 coverage atlas,
 * 4 MiB VBO), splitting heavy strokes into 4x more atlas batches and tiled
 * passes on desktop GPUs. When `deviceMemory` is unavailable on a desktop-class
 * GPU (`maxTextureSize >= 8192` and not a coarse-pointer device), use the
 * 128 MiB tier (512x512 atlas, 8 MiB VBO).
 */
export function studioVramBudget(params: {
  readonly deviceMemory: number | undefined;
  readonly maxTextureSize: number;
  readonly coarsePointer: boolean;
}): number {
  if (params.deviceMemory !== undefined) {
    if (params.deviceMemory >= 8) return 256 * MB;
    if (params.deviceMemory >= 4) return 128 * MB;
    return 64 * MB;
  }
  if (!params.coarsePointer && params.maxTextureSize >= 8192) {
    return 128 * MB;
  }
  return 64 * MB;
}

/** Logical side length of the coverage atlas for a given VRAM budget tier and supersample factor. */
export function atlasLogicalSizeForTier(budgetBytes: number, supersample: number): number {
  if (supersample <= 2) {
    return budgetBytes >= 128 * MB ? 1024 : 512;
  }
  return budgetBytes >= 128 * MB ? 512 : 256;
}

/** Byte size of one RGBA8 sheet texture, optionally including a full mipmap chain (+1/3). */
export function sheetTextureBytes(width: number, height: number, mipmapped: boolean): number {
  const base = width * height * 4;
  return mipmapped ? Math.ceil((base * 4) / 3) : base;
}

/** Byte size of the single-sample supersampled coverage atlas (color texture + stencil renderbuffer). */
export function atlasBytes(logicalSide: number, supersample: number, formats: AtlasFormats): number {
  const phys = logicalSide * supersample;
  const pixels = phys * phys;
  const colorBpp = formats.color === 'R8' ? 1 : 4;
  const stencilBpp = formats.stencil === 'STENCIL_INDEX8' ? 1 : 4;
  return pixels * (colorBpp + stencilBpp);
}

/** Byte size of the bounded native-fallback scratch tile (RGBA8, `logicalSide x logicalSide`). */
export function nativeFallbackTileBytes(logicalSide: number): number {
  return logicalSide * logicalSide * 4;
}

/** Shared VBO/arena ceiling by VRAM tier. */
export function vboBudgetForTier(budgetBytes: number): number {
  if (budgetBytes >= 256 * MB) return 16 * MB;
  if (budgetBytes >= 128 * MB) return 8 * MB;
  return 4 * MB;
}

export interface SceneVramRequest {
  readonly budgetBytes: number;
  readonly sheetWidth: number;
  readonly sheetHeight: number;
  readonly formats: AtlasFormats;
  readonly supersample: number;
  readonly needsMipmap: boolean;
  readonly hasGhosts: boolean;
  readonly hasBlend: boolean;
  readonly hasLiveCoat: boolean;
}

export interface SceneVramPlan {
  readonly fits: boolean;
  readonly atlasLogicalSide: number;
  readonly atlasBytes: number;
  readonly vboBytes: number;
  readonly workingSlots: number;
  readonly workingBytes: number;
  readonly retainedHeadroomBytes: number;
}

/**
 * Computes required working VRAM for a scene before allocating GL resources.
 *
 * Working set:
 * - `slotA` (final sheet / blend ping-pong A, mipmapped when minified)
 * - `slotB` (layer / blend ping-pong B scratch)
 * - `slotC` (flat-coat `#mask` / isolated layer scratch)
 * - Pinned `#under` ghost composite when `hasGhosts` is true (so live strokes
 *   never recompute onion ghosts per frame — J1-O5 / frame-rendering/spec.md:410)
 * - Coverage atlas + shared VBO arena
 *
 * When `fits === false`, the caller cleanly routes the scene to Canvas 2D
 * rather than risking OOM or violating ghost-caching guarantees.
 */
export function planSceneVram(req: SceneVramRequest): SceneVramPlan {
  const atlasSide = atlasLogicalSizeForTier(req.budgetBytes, req.supersample);
  const atlas = atlasBytes(atlasSide, req.supersample, req.formats);
  const nativeScratch = nativeFallbackTileBytes(atlasSide);
  const vbo = vboBudgetForTier(req.budgetBytes);

  const slotA = sheetTextureBytes(req.sheetWidth, req.sheetHeight, req.needsMipmap);
  const plainSheet = sheetTextureBytes(req.sheetWidth, req.sheetHeight, false);
  // Base 3 aliased slots (slotA + slotB + slotC) handle plain, blended, and flat-coat passes.
  // Adding ghosts pins `#under` (+1 sheet) so live strokes never rebuild ghosts.
  const extraSlots = req.hasGhosts ? 3 : 2;
  const workingSlots = 1 + extraSlots;
  const workingBytes = slotA + plainSheet * extraSlots + atlas + nativeScratch + vbo;
  const fits = workingBytes <= req.budgetBytes;
  return {
    fits,
    atlasLogicalSide: atlasSide,
    atlasBytes: atlas,
    vboBytes: vbo,
    workingSlots,
    workingBytes,
    retainedHeadroomBytes: Math.max(0, req.budgetBytes - workingBytes),
  };
}

interface RetainedEntry {
  readonly bytes: number;
  readonly free: () => void;
}

/**
 * Proactive VRAM budget manager for one WebGL2 context generation.
 *
 * Evicts LRU retained entries BEFORE allocating new textures, and permanently
 * poisons the generation on `markOutOfMemory()` (OpenGL ES 3.0.6 §2.5 leaves GL
 * state undefined after OUT_OF_MEMORY, so callers must discard the context and
 * fall back to Canvas 2D rather than retrying in place).
 */
export class VramBudget {
  readonly #budget: number;
  #working = 0;
  #retained = 0;
  #oom = false;
  readonly #entries = new Map<string, RetainedEntry>();

  constructor(budgetBytes: number) {
    this.#budget = budgetBytes;
  }

  get budget(): number {
    return this.#budget;
  }

  get workingBytes(): number {
    return this.#working;
  }

  get retainedBytes(): number {
    return this.#retained;
  }

  get headroom(): number {
    return Math.max(0, this.#budget - this.#working);
  }

  get oom(): boolean {
    return this.#oom;
  }

  /** Sets required working-set bytes and proactively evicts retained entries to fit. */
  reserveWorking(bytes: number): boolean {
    if (this.#oom || bytes > this.#budget) {
      return false;
    }
    this.#working = bytes;
    this.#evictToFit(0);
    return true;
  }

  /** Refreshes LRU recency of an already-retained key. */
  touch(key: string): void {
    const entry = this.#entries.get(key);
    if (!entry) return;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
  }

  /**
   * Reserves `bytes` from retained headroom (proactively evicting oldest entries
   * first). Returns false without touching existing entries if `bytes` cannot
   * fit in `headroom` or the generation is poisoned by OOM.
   */
  tryRetain(key: string, bytes: number, free: () => void): boolean {
    if (this.#oom || bytes > this.headroom) {
      return false;
    }
    const prev = this.#entries.get(key);
    if (prev) {
      this.#entries.delete(key);
      this.#retained -= prev.bytes;
      prev.free();
    }
    this.#evictToFit(bytes);
    if (this.#working + this.#retained + bytes > this.#budget) {
      return false;
    }
    this.#entries.set(key, { bytes, free });
    this.#retained += bytes;
    return true;
  }

  /** Releases one retained key by name. */
  release(key: string): void {
    const entry = this.#entries.get(key);
    if (!entry) return;
    this.#entries.delete(key);
    this.#retained -= entry.bytes;
    entry.free();
  }

  /** Poisons this WebGL2 generation after GL_OUT_OF_MEMORY and frees all retained entries. */
  markOutOfMemory(): void {
    this.#oom = true;
    this.clearRetained();
  }

  /** Frees all retained entries (used on dispose or sheet resize). */
  clearRetained(): void {
    for (const entry of this.#entries.values()) {
      entry.free();
    }
    this.#entries.clear();
    this.#retained = 0;
  }

  #evictToFit(needed: number): void {
    while (this.#working + this.#retained + needed > this.#budget && this.#entries.size > 0) {
      const oldestKey = this.#entries.keys().next().value!;
      const oldest = this.#entries.get(oldestKey)!;
      this.#entries.delete(oldestKey);
      this.#retained -= oldest.bytes;
      oldest.free();
    }
  }
}
