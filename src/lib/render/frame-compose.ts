/**
 * How a frame is put together, for everyone who puts one together.
 *
 * A frame on the editor's canvas is not one picture but a stack: the layers
 * below the active one, the ghosts of the onion between them, the active layer
 * with the line under the hand on it, and the layers above. Each part lives in
 * a buffer of its own, because an eraser must cut the alpha of its own layer
 * and nothing else, and because the parts go stale at different times.
 *
 * Nothing here knows a brush, a tool or an editor: a scene says what to draw,
 * and a line that cannot be added to brings its own way of drawing itself.
 * What goes over the frame — the paper, the clip to the sheet, a tool's grid —
 * belongs to whoever is showing it, not to the frame.
 */

import { resolveCell } from '../model/cells';
import type { Frame, ToolDescriptor, ToonDocument } from '../format/types';
import { BufferRing } from '../ui/buffer-ring';
import { blitLayer, hasLook, renderOpaqueRun, layLayer, renderLayersStacked, renderLivePart, renderStrokesLayer, STUDIO_PATHS, type Canvas2DLike, type LayerLook, type PlacedStroke } from './canvas2d';
import { extendsFlatRun, hasInteriorPaint, isFlatPaint, sameFlatPaint, type FlatPaint } from './dispatch';
import { CellCache, cellBudget, type Ink } from './cell-cache';
import type { Viewport } from './contract';
import type { StrokeGeometry } from './smoothing';
import type { DeclarativeLiveStroke } from './sheet-composer';

const RASTER_INK = Symbol('raster ink');

/** What the composed frame is painted onto. */
export interface ComposeTarget extends Canvas2DLike {
  globalAlpha: number;
}

/** A transparent off-screen buffer one part of the frame is drawn into. */
export interface ComposeBuffer {
  readonly ctx: Canvas2DLike;
  readonly image: CanvasImageSource;
  /** Gives it this size. What was on it survives only if the size was already that. */
  size(width: number, height: number): void;
  clear(): void;
}

export type BufferFactory = () => ComposeBuffer;

/**
 * The editor's budget for kept cells: by the device's memory where the browser
 * tells it (cell-cache.ts `cellBudget`) — 64 MB is 17 sheets of 1280×720.
 */
export const CELL_CACHE_BYTES = cellBudget(
  typeof navigator === 'undefined' ? undefined : (navigator as { deviceMemory?: number }).deviceMemory,
);

export interface ComposerOptions {
  /**
   * Pixels, in bytes, the composer may keep of cells it has rasterized, to lay
   * the same cell again as a copy (cell-cache.ts). Absent or 0: none kept.
   */
  cellBytes?: number;
}

/** A ghost frame: which frame, how strongly it shows, and the colour it is painted in. */
export interface GhostFrame {
  readonly index: number;
  readonly alpha: number;
  /** Every line of the ghost in this colour, its alpha kept. */
  readonly tint?: string;
}

/**
 * The line under the hand.
 *
 * A line that only grows at its end is given as points: the composer keeps the
 * settled part on its buffer and draws the rest over the frame, so the cost of
 * a frame does not grow with the length of the stroke. A line whose whole
 * shape decides what it paints — an eraser cutting alpha, a pen filling what
 * it encloses — brings `paint`, and the composer draws it whole every frame.
 */
export interface LiveLine {
  /** The gesture this line belongs to; a new one starts the buffer over. */
  readonly id: number;
  /** Set when the line cuts the alpha of its layer instead of painting on it. */
  readonly erase?: boolean;
  /** paint() uses the alpha supplied by the composer, which applies opacity once per coat. */
  readonly flat?: FlatPaint;
  /** Paints the line whole onto a target. Absent means it can be added to. */
  readonly paint?: (target: Canvas2DLike) => void;
  /** Declarative equivalent of `paint` for non-Canvas2D backends (WebGL2). */
  readonly spec?: DeclarativeLiveStroke;
  /** Points of an incremental line, or the outline a flat stroke may fill. */
  readonly points?: readonly number[];
  readonly geometry?: StrokeGeometry;
  readonly width?: number;
  readonly color?: string;
}

/** Everything the composer needs to know about one frame. */
export interface FrameScene {
  readonly doc: ToonDocument;
  readonly frame: number;
  /** The layer the live line belongs to, and the seam the ghosts sit in. */
  readonly activeLayer: number;
  readonly viewport: Viewport;
  /** The tool table the stack draws with; the document's own unless a preview adds to it. */
  readonly tools: readonly ToolDescriptor[];
  /** A cell as it should be drawn, where that is not the cell in the document. */
  readonly cellAt?: (layer: number, frame: number) => Frame | undefined;
  /** Ghost frames, and the layers each of them is flattened from. */
  readonly ghosts?: { readonly frames: readonly GhostFrame[]; readonly layers: readonly number[] };
  readonly live?: LiveLine | null;
  /** What the whole frame is blitted at; a profile dims the frame being drawn. */
  readonly alpha?: number;
  /**
   * The ghosts go under the whole frame instead of into its stack, so a frame
   * filled solid, blitted at `alpha`, lets them show through.
   */
  readonly blend?: boolean;
  /**
   * The colour of the paper the frame will lie on. A layer with a blend mode
   * is laid over the paper too, so where one is shown the frame starts with
   * it; absent, every mode is laid over transparency.
   */
  readonly paper?: string;
}

/** Part of the stack drawn in one buffer and laid in one blit, with the look of its one layer if it has one. */
interface Chunk {
  readonly buffer: ComposeBuffer;
  readonly look: LayerLook | undefined;
  readonly ink: boolean;
}

/**
 * Splits layers into what can be flattened ahead: plain and translucent
 * layers together (an alpha over what is laid before it is still the same
 * picture whatever lies under), each blended layer alone — its mode needs
 * what lies under it, which is known only when the frame is composed.
 */
function chunked(cells: readonly Frame[], looks: readonly LayerLook[]): { cells: Frame[]; looks: (LayerLook | undefined)[]; look?: LayerLook }[] {
  const groups: { cells: Frame[]; looks: (LayerLook | undefined)[]; look?: LayerLook }[] = [];
  let run: { cells: Frame[]; looks: (LayerLook | undefined)[] } | null = null;
  for (const [i, cell] of cells.entries()) {
    const look = looks[i];
    if (look.blend) {
      groups.push({ cells: [cell], looks: [undefined], look });
      run = null;
      continue;
    }
    if (!run) {
      run = { cells: [], looks: [] };
      groups.push(run);
    }
    run.cells.push(cell);
    run.looks.push(hasLook(look) ? look : undefined);
  }
  return groups;
}

/** Whether `doc` shows a blended layer: then its frame is laid over the paper. */
function showsBlend(doc: ToonDocument): boolean {
  return doc.layers.some((layer) => !layer.hidden && layer.blend !== undefined);
}

/**
 * At most the onion depth on each side (`ONION_SIDE_MAX_FRAMES`), so a handful
 * of cells. Made only when asked for: two ghosts take two buffers.
 */
// ponytail: ten stage-sized buffers at the deepest onion, ~37 MB at density 2;
// a ghost the size of the sheet if a phone reloads under it.
const GHOST_BUFFERS = 10;

function domBuffer(): ComposeBuffer {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D context unavailable for a frame buffer');
  }
  const like = ctx as unknown as Canvas2DLike;
  return {
    ctx: like,
    image: canvas as unknown as CanvasImageSource,
    size(width, height) {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    },
    clear() {
      like.setTransform(1, 0, 0, 1, 0, 0);
      like.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}

export class FrameComposer {
  readonly #make: BufferFactory;
  /** Buffers of the layers below the active one, a chunk each; the first is made before any other. */
  #belowBuffers: ComposeBuffer[] = [];
  #active: ComposeBuffer | undefined;
  #aboveBuffers: ComposeBuffer[] = [];
  #belowChunks: Chunk[] = [];
  #aboveChunks: Chunk[] = [];
  /** The active layer's look, laid with it; undefined when it is plain. */
  #activeLook: LayerLook | undefined;
  /** The active layer with the end of the line under the hand, before it is laid with its look. */
  #looked: ComposeBuffer | undefined;
  /** One layer is rasterized here before it lands on a stack buffer. */
  #scratch: ComposeBuffer | undefined;
  #mask: ComposeBuffer | undefined;
  /** When a live line extends a coat, keep the underlying pixels and its opaque marks apart. */
  #coatBase: ComposeBuffer | undefined;
  #coatMarks: ComposeBuffer | undefined;
  #extendsCoat = false;

  /** The active layer plus the settled part of the line under the hand. */
  #live: ComposeBuffer | undefined;
  /** The whole frame, when it is blitted at an alpha below one. */
  #composite: ComposeBuffer | undefined;
  /** The ghosts flattened at their alphas, over the layers below when the stack takes them in. */
  #under: ComposeBuffer | undefined;
  #underSeed = '';
  /** Bumped by every repaint of the layers below, so the flattened ghosts know to start over. */
  #belowSerial = 0;
  readonly #ghosts: BufferRing<ComposeBuffer>;

  // ponytail: every buffer is the whole stage, table included — about ten of
  // them, ~37 MB at density 2 on a phone. Sizing them to the sheet ∩ stage
  // needs an origin threaded through the blits, the live tail and the
  // pipette's reads of `layers`; worth it if a low-memory device reloads.
  #stale = true;
  #width = 0;
  #height = 0;
  /** Bumped by every rebuild of the stack, so the live buffer knows to start over. */
  #serial = 0;
  #liveSeed = '';
  #livePainted = 0;
  /**
   * Whether the layers below and above the active one hold a line at all. A
   * drawing of one layer is the common case, and two blits of transparent
   * stage-sized buffers per frame of a stroke were half of what a weak phone
   * spent compositing it.
   */
  #belowInk = false;
  /** What each buffer was last painted from, the view it was painted under and the looks it was laid with. */
  readonly #ink = new WeakMap<ComposeBuffer, { view: string; ink: readonly (readonly unknown[])[]; standIn: boolean; looks: string }>();
  /** Cells rasterized before, by what they hold; absent when none are kept. */
  readonly #cells: CellCache | undefined;
  /**
   * Cells the scene put in place of the document's (a lasso's moved strokes):
   * new under every move of the hand, so never worth keeping.
   */
  #standIns = new WeakSet<Frame>();

  constructor(make: BufferFactory = domBuffer, options: ComposerOptions = {}) {
    this.#make = make;
    this.#ghosts = new BufferRing(GHOST_BUFFERS, make);
    this.#cells = options.cellBytes ? new CellCache(make, options.cellBytes) : undefined;
  }

  /** The cells it keeps, for whoever rasterizes some ahead (cell-warm.ts); absent when none are kept. */
  get cells(): CellCache | undefined {
    return this.#cells;
  }

  /**
   * The document, the frame or the view may have changed: the stack is looked
   * at again. What it finds unchanged it leaves painted.
   */
  invalidate(): void {
    this.#stale = true;
  }

  /**
   * Gives every buffer's pixels back at once. The canvas that composed with
   * it is gone, and a backing store is freed only when the collector gets to
   * it — Safari counts canvas memory against a cap of its own, and a studio
   * opened and left a few times over ran into it. After this the composer
   * starts from nothing, as a new one would.
   */
  dispose(): void {
    const buffers = [...this.#belowBuffers, this.#active, ...this.#aboveBuffers, this.#looked, this.#scratch, this.#mask, this.#coatBase, this.#coatMarks,
      this.#live, this.#composite, this.#under, ...this.#ghosts.drain()];
    this.#cells?.dispose();
    for (const buffer of buffers) {
      buffer?.size(0, 0);
    }
    this.#active = this.#looked = this.#scratch = this.#live = this.#composite = this.#under = undefined;
    this.#mask = this.#coatBase = this.#coatMarks = undefined;
    this.#belowBuffers = [];
    this.#aboveBuffers = [];
    this.#belowChunks = [];
    this.#aboveChunks = [];
    this.#underSeed = '';
    this.#stale = true;
    this.#width = 0;
    this.#height = 0;
    this.#liveSeed = '';
    this.#livePainted = 0;
  }

  /**
   * The buffers of the stack as they were last composed, bottom-up, each with
   * the look it is laid with, for a caller that has to read the frame back
   * rather than show it — the pipette takes the colour of the canvas off
   * them. `active` is the active layer as it is drawn, without its look. Null
   * before the first frame.
   */
  get layers(): {
    below: { image: CanvasImageSource; look?: LayerLook }[];
    active: CanvasImageSource;
    activeLook?: LayerLook;
    above: { image: CanvasImageSource; look?: LayerLook }[];
  } | null {
    if (!this.#active) return null;
    const parts = (chunks: readonly Chunk[]) => chunks.filter((c) => c.ink).map((c) => ({ image: c.buffer.image, look: c.look }));
    return { below: parts(this.#belowChunks), active: this.#active.image, activeLook: this.#activeLook, above: parts(this.#aboveChunks) };
  }

  /**
   * Paints the frame onto `target`. What goes over it — paper, clip, grid —
   * is the caller's; the composer draws layers on a transparent ground.
   */
  compose(target: ComposeTarget, width: number, height: number, scene: FrameScene): void {
    if (this.#stale || this.#width !== width || this.#height !== height) {
      this.#rebuild(scene, width, height);
      this.#stale = false;
      this.#width = width;
      this.#height = height;
    }
    const active = this.#withLive(scene, width, height);
    const alpha = scene.alpha ?? 1;
    const paper = !scene.blend && scene.paper !== undefined && showsBlend(scene.doc) ? scene.paper : undefined;
    // The layers below flatten with the ghosts when they are one plain buffer;
    // a blended one among them is laid over the paper at compose time, and the
    // ghosts go over it after. Blended, the ghosts lie under the whole frame.
    const oneBelow = this.#belowChunks.length <= 1 && !this.#belowChunks[0]?.look;
    const under = this.#flatten(scene, width, height, !scene.blend && oneBelow);
    const stack = (into: ComposeTarget, ghosts: boolean): void => {
      if (paper !== undefined) {
        into.setTransform(1, 0, 0, 1, 0, 0);
        into.fillStyle = paper;
        into.fillRect(0, 0, width, height);
      }
      if (ghosts && under && oneBelow) {
        blitLayer(under.image, into);
      } else {
        this.#layChunks(this.#belowChunks, into);
        if (ghosts && under) blitLayer(under.image, into);
      }
      this.#layActive(active, into, scene, width, height);
      this.#layChunks(this.#aboveChunks, into);
    };
    if (alpha < 1) {
      // The profile's alpha applies to the whole frame, so the stack has to be
      // composited before it is blitted rather than layer by layer.
      const composite = (this.#composite ??= this.#make());
      composite.size(width, height);
      composite.clear();
      const cctx = composite.ctx as ComposeTarget;
      if (scene.blend && under) blitLayer(under.image, target);
      stack(cctx, !scene.blend);
      target.globalAlpha = alpha;
      blitLayer(composite.image, target);
      target.globalAlpha = 1;
      return;
    }
    stack(target, true);
  }

  #layChunks(chunks: readonly Chunk[], into: ComposeTarget): void {
    for (const chunk of chunks) {
      if (chunk.ink) layLayer(chunk.buffer.image, into, chunk.look);
    }
  }

  /** The active layer and the end of the line under the hand, together with its look. */
  #layActive(active: ComposeBuffer, into: ComposeTarget, scene: FrameScene, width: number, height: number): void {
    const look = this.#activeLook;
    if (!look) {
      blitLayer(active.image, into);
      this.#paintLiveTail(into, scene);
      return;
    }
    const looked = (this.#looked ??= this.#make());
    looked.size(width, height);
    looked.clear();
    blitLayer(active.image, looked.ctx);
    this.#paintLiveTail(looked.ctx as ComposeTarget, scene);
    layLayer(looked.image, into, look);
  }

  /** Rasterizes the frame into the buffers of the stack. */
  #rebuild(scene: FrameScene, width: number, height: number): void {
    const layers = scene.doc.layers;
    const below: Frame[] = [];
    const belowLooks: LayerLook[] = [];
    const above: Frame[] = [];
    const aboveLooks: LayerLook[] = [];
    for (let l = 0; l < layers.length; l++) {
      const cell = this.#cell(scene, l);
      if (!cell || layers[l].hidden || l === scene.activeLayer) {
        continue;
      }
      if (l < scene.activeLayer) {
        below.push(cell);
        belowLooks.push(layers[l]);
      } else {
        above.push(cell);
        aboveLooks.push(layers[l]);
      }
    }
    // Made in this order before anything else: below, active, above.
    this.#belowBuffers[0] ??= this.#make();
    this.#active ??= this.#make();
    this.#aboveBuffers[0] ??= this.#make();
    const inked = (cells: readonly Frame[]): boolean => cells.some((c) => c.raster !== undefined || c.strokes.length > 0);
    const paint = (groups: ReturnType<typeof chunked>, pool: ComposeBuffer[]): { chunks: Chunk[]; painted: boolean } => {
      let painted = false;
      // An empty side still paints its first buffer empty, so nothing stale is left on it.
      const shown = groups.length > 0 ? groups : [{ cells: [], looks: [] }];
      const chunks = shown.map((group, i) => {
        const buffer = (pool[i] ??= this.#make());
        if (this.#paint(buffer, group.cells, scene, width, height, false, group.looks)) painted = true;
        return { buffer, look: 'look' in group ? group.look : undefined, ink: inked(group.cells) };
      });
      return { chunks, painted };
    };
    const lower = paint(chunked(below, belowLooks), this.#belowBuffers);
    if (lower.painted) {
      this.#belowSerial += 1;
    }
    this.#belowChunks = lower.chunks;
    this.#aboveChunks = paint(chunked(above, aboveLooks), this.#aboveBuffers).chunks;
    this.#belowInk = this.#belowChunks.some((c) => c.ink);
    const cell = this.#cell(scene, scene.activeLayer);
    const own = layers[scene.activeLayer];
    const visible = cell && !own?.hidden ? [cell] : [];
    this.#activeLook = own && hasLook(own) ? { opacity: own.opacity, blend: own.blend } : undefined;
    if (this.#paint(this.#active, visible, scene, width, height)) {
      this.#serial += 1;
    }
  }

  #cell(scene: FrameScene, layer: number): Frame | undefined {
    const row = scene.doc.layers[layer];
    const own = row && scene.frame < row.frames.length ? resolveCell(row, scene.frame) : undefined;
    if (!scene.cellAt) {
      return own;
    }
    const shown = scene.cellAt(layer, scene.frame);
    if (shown && shown !== own) {
      this.#standIns.add(shown);
    }
    return shown;
  }

  /**
   * Rasterizes `cells` into a transparent buffer, bottom-up — what of them is
   * not on it already. A buffer holding the same strokes is left as it is, and
   * one whose single layer only gained strokes at its end takes those on top:
   * a finished line costs one line, whatever lies around it. Says whether the
   * buffer was drawn on. `afresh` is for a buffer handed out of a pool, which
   * holds whatever its last owner left.
   */
  #paint(
    buffer: ComposeBuffer,
    cells: readonly Frame[],
    scene: FrameScene,
    width: number,
    height: number,
    afresh = false,
    /** Each cell's look, by position, for a buffer that lays some layers translucent. */
    looks?: readonly (LayerLook | undefined)[],
  ): boolean {
    const { viewport } = scene;
    const lookKey = looks?.map((look) => (hasLook(look) ? `${look!.opacity ?? ''}/${look!.blend ?? ''}` : '')).join(',') ?? '';
    const plain = !looks?.some(hasLook);
    const view = `${width}x${height}@${viewport.scale}:${viewport.dpr}:${viewport.panX ?? 0}:${viewport.panY ?? 0}`;
    // A stroke is its points, its tool and its pressure: an edit in place
    // (the distort brush) swaps the points of a stroke that stays where it was.
    // A selection being moved keeps its points and changes its matrix, which
    // stands in the pressure's place — the area repaint reads only the first
    // two, and a stand-in cell is never kept.
    const ink = cells.map((cell) => cell.raster
      ? [RASTER_INK, cell.raster, viewport.raster?.(cell.raster)]
      : cell.strokes.flatMap((s) => [s.points, scene.tools[s.tool_id], (s as PlacedStroke).place ?? s.pressure]));
    const held = afresh ? undefined : this.#ink.get(buffer);
    // Laid with other looks, what the buffer holds is no start for these.
    const was = held && held.looks === lookKey ? held : undefined;
    // Not until it is painted: a stroke that throws half-way leaves a buffer
    // that holds neither what it had nor what it was asked for.
    this.#ink.delete(buffer);
    // What a buffer held in place of the document's cell — a selection being
    // moved — is no cell to come back to: kept, every move cost a sheet of the
    // cache and pushed a real cell out of it. Nor is it repainted by area.
    // A buffer laid with a look holds no cell's own pixels, nor takes lines on top.
    const keepable = was !== undefined && !was.standIn && plain;
    const painted = this.#lay(buffer, cells, scene, width, height, was?.view === view ? was.ink : undefined, ink, keepable, looks);
    this.#ink.set(buffer, { view, ink, standIn: cells.some((cell) => this.#standIns.has(cell)), looks: lookKey });
    return painted;
  }

  #paintMask(width: number, height: number): ComposeBuffer {
    const mask = this.#mask ??= this.#make();
    mask.size(width, height);
    return mask;
  }

  #lay(
    buffer: ComposeBuffer,
    cells: readonly Frame[],
    scene: FrameScene,
    width: number,
    height: number,
    was: readonly (readonly unknown[])[] | undefined,
    ink: readonly (readonly unknown[])[],
    keepable: boolean,
    looks?: readonly (LayerLook | undefined)[],
  ): boolean {
    const kept = was !== undefined && was.length === ink.length
      && was.every((old, c) => old.length <= ink[c].length && old.every((part, i) => part === ink[c][i]));
    if (kept && was?.every((old, c) => old.length === ink[c].length)) {
      return false;
    }
    const raster = ink.some((cell) => cell[0] === RASTER_INK);
    if (raster || was?.some((cell) => cell[0] === RASTER_INK)) {
      // Raster images already are cell caches. Vector repaint and worker
      // caches keep only stroke triples and have no access to the image.
      was = undefined;
      keepable = false;
    }
    const had = was?.[0]?.length ?? 0;
    // A few lines more go on top; a cell put whole (a file opened over an
    // empty one) goes through the cache, so it is kept like any other.
    const grown = (ink[0]?.length ?? 0) - had;
    const mask = () => this.#paintMask(width, height);
    if (kept && was && !looks?.some(hasLook) && cells.length === 1 && (grown <= 3 * 8 || grown <= had)) {
      const strokes = cells[0].strokes;
      const start = had / 3;
      // A matching tail is already translucent on the buffer. Rebuild its coat together.
      if (!extendsFlatRun(strokes, start, scene.tools)) {
        renderStrokesLayer({ strokes: strokes.slice(start) }, scene.tools, buffer.ctx, scene.viewport, undefined, STUDIO_PATHS, mask);
        return true;
      }
    }
    // The area a stroke took is read off its points; a moved one stood where
    // its matrix put it, so a buffer that held a moved selection is drawn whole.
    if (was !== undefined && keepable && cells.length === 1 && was.length === 1
      && !this.#cells?.has(cells[0], scene.tools, scene.viewport, width, height)
      && repaintTaken(buffer.ctx, cells[0], was[0], ink[0], scene, width, height)) {
      return true;
    }
    // What the buffer holds is one cell drawn whole or added to: kept as a
    // copy before it is drawn over, the cell the hand just left is ready as a
    // ghost and to come back to.
    if (this.#cells && keepable && was !== undefined && was.length === 1 && was[0].length > 0) {
      const flat = was[0];
      const triples = [];
      for (let i = 0; i < flat.length; i += 3) {
        triples.push([flat[i], flat[i + 1], flat[i + 2]] as const);
      }
      this.#cells.keepCopy(triples as unknown as Ink, scene.viewport, width, height, buffer.image);
    }
    buffer.size(width, height);
    buffer.clear();
    const apart = () => {
      const scratch = (this.#scratch ??= this.#make());
      scratch.size(width, height);
      scratch.clear();
      return scratch;
    };
    if (this.#cells && !raster) {
      // Each cell from the kept ones, or rasterized into one and kept: a cell
      // in its own buffer is a layer apart, so an eraser cuts only its own.
      const kept = this.#cells;
      for (const [c, cell] of cells.entries()) {
        if (cell.strokes.length === 0) {
          continue; // nothing to lay, and no room to spend on it
        }
        const own = (target: ComposeBuffer) => renderLayersStacked([cell], scene.tools, target.ctx, scene.viewport, apart, STUDIO_PATHS, undefined, false, mask);
        const pixels = this.#standIns.has(cell)
          ? null
          : kept.take(cell, scene.tools, scene.viewport, width, height, own);
        if (pixels) {
          layLayer(pixels.image, buffer.ctx, looks?.[c]);
        } else {
          const scratch = apart();
          own(scratch);
          layLayer(scratch.image, buffer.ctx, looks?.[c]);
        }
      }
      return true;
    }
    // Layers that erase nothing go straight onto the buffer; one that erases
    // above another is rasterized apart, so its eraser cuts only its own.
    renderLayersStacked(cells, scene.tools, buffer.ctx, scene.viewport, apart, STUDIO_PATHS, looks, false, mask);
    return true;
  }

  /**
   * The active layer with the line under the hand on it. A line that can be
   * added to leaves its settled part here between frames; one that cannot is
   * laid down whole, every frame, over a fresh copy of the layer.
   */
  #withLive(scene: FrameScene, width: number, height: number): ComposeBuffer {
    const live = scene.live;
    if (!live) {
      this.#liveSeed = '';
      this.#livePainted = 0;
      return this.#active!;
    }
    const buffer = (this.#live ??= this.#make());
    buffer.size(width, height);
    const ctx = buffer.ctx;
    const { viewport } = scene;
    const seed = `${live.id}:${this.#serial}:${width}x${height}`
      + `@${viewport.scale}:${viewport.panX}:${viewport.panY}`;
    const reseed = (): void => {
      buffer.clear();
      ctx.drawImage(this.#active!.image, 0, 0);
    };
    if (live.flat && live.paint) {
      const tool = live.flat;
      const coatSeed = seed + ':' + tool.color + ':' + tool.opacity + ':' + ('fill' in tool ? tool.fill : '');
      if (this.#liveSeed !== coatSeed) {
        const strokes = this.#cell(scene, scene.activeLayer)?.strokes ?? [];
        let start = strokes.length;
        while (start > 0 && sameFlatPaint(tool, scene.tools[strokes[start - 1].tool_id])) start--;
        this.#extendsCoat = start < strokes.length;
        if (this.#extendsCoat) {
          const base = this.#coatBase ??= this.#make();
          base.size(width, height);
          base.clear();
          renderStrokesLayer({ strokes: strokes.slice(0, start) }, scene.tools, base.ctx, viewport,
            undefined, STUDIO_PATHS, () => this.#paintMask(width, height));
          const marks = this.#coatMarks ??= this.#make();
          marks.size(width, height);
          marks.clear();
          renderOpaqueRun(strokes, start, strokes.length, scene.tools, marks.ctx, viewport, undefined, STUDIO_PATHS);
        }
        this.#liveSeed = coatSeed;
      }
      if (!this.#extendsCoat && !hasInteriorPaint(tool, live.points ?? [])) {
        reseed();
        ctx.globalAlpha = tool.opacity / 100;
        try {
          live.paint(ctx);
        } finally {
          ctx.globalAlpha = 1;
        }
        return buffer;
      }
      const mask = this.#paintMask(width, height);
      mask.clear();
      if (this.#extendsCoat) blitLayer(this.#coatMarks!.image, mask.ctx);
      live.paint(mask.ctx);
      buffer.clear();
      blitLayer((this.#extendsCoat ? this.#coatBase! : this.#active!).image, ctx);
      layLayer(mask.image, ctx, tool);
      return buffer;
    }
    if (live.paint) {
      reseed();
      this.#liveSeed = '';
      this.#livePainted = 0;
      ctx.globalCompositeOperation = live.erase ? 'destination-out' : 'source-over';
      // The line is a brush's code. One that throws must not leave the buffer
      // erasing: the next frame laid the active layer into it that way, and
      // the layer was gone from the sheet.
      try {
        live.paint(ctx);
      } finally {
        ctx.globalCompositeOperation = 'source-over';
      }
      return buffer;
    }
    const points = live.points ?? [];
    // Every command but the last two is settled: the thinning keeps the point
    // under the hand twice at the end, and a command reaches one point past
    // its own.
    const settled = Math.max(0, points.length / 2 - 3);
    if (seed !== this.#liveSeed || settled < this.#livePainted) {
      reseed();
      this.#liveSeed = seed;
      this.#livePainted = 0;
    }
    if (settled > this.#livePainted) {
      // A join is the command the sub-path starts *after*, so the stretch that
      // adds commands `painted`…`settled - 1` joins one before.
      const drawn = renderLivePart(
        points, live.geometry ?? 'smooth', live.width ?? 1, live.color ?? '#000000',
        ctx, viewport, this.#livePainted - 1, settled - 1,
      );
      if (drawn) {
        this.#livePainted = settled;
      }
    }
    return buffer;
  }

  /** The end of the live line, still moving: it goes over the frame, not into it. */
  #paintLiveTail(target: ComposeTarget, scene: FrameScene): void {
    const live = scene.live;
    if (!live || live.paint) {
      return;
    }
    const points = live.points ?? [];
    const from = this.#livePainted - 1;
    if (from <= 0) {
      // Too short to have settled anything: the whole line, every frame.
      renderLivePart(
        points, live.geometry ?? 'smooth', live.width ?? 1, live.color ?? '#000000',
        target, scene.viewport, 0,
      );
      return;
    }
    renderLivePart(
      points, live.geometry ?? 'smooth', live.width ?? 1, live.color ?? '#000000',
      target, scene.viewport, from,
    );
  }

  /**
   * The ghosts, flattened into one buffer at their alphas — over the layers
   * below the active one when `withBelow`. They sit where the active layer sits
   * in the stack, so a ghost never covers the line being drawn. Null when no
   * ghost has a line to show.
   *
   * Laid over the sheet one by one on every frame, the ghosts made a frame of
   * a stroke dearer on a layer whose neighbouring frames are drawn than on one
   * whose are empty, and under the same brush the line trailed the hand on the
   * first and not on the second. Flattened, they are repainted only when they
   * or the layers below change, and a frame of a stroke costs the same blits
   * with them as without.
   */
  #flatten(scene: FrameScene, width: number, height: number, withBelow: boolean): ComposeBuffer | null {
    const ghosts = scene.ghosts;
    if (!ghosts || ghosts.frames.length === 0) {
      return null;
    }
    const shown: { buffer: ComposeBuffer; alpha: number }[] = [];
    const keys: string[] = [];
    for (const ghost of ghosts.frames) {
      const taken = this.#ghost(scene, ghost, ghosts.layers, width, height);
      if (taken) {
        shown.push({ buffer: taken.buffer, alpha: ghost.alpha });
        keys.push(`${taken.key}@${ghost.alpha}`);
      }
    }
    if (shown.length === 0) {
      return null;
    }
    const below = withBelow && this.#belowInk;
    const seed = `${below ? this.#belowSerial : '-'}:${width}x${height}|${keys.join('|')}`;
    const under = (this.#under ??= this.#make());
    if (seed === this.#underSeed) {
      return under;
    }
    // Not until it is painted: a ghost that throws half-way leaves a buffer
    // that holds neither what it had nor what it was asked for.
    this.#underSeed = '';
    under.size(width, height);
    under.clear();
    const ctx = under.ctx as ComposeTarget;
    if (below) blitLayer(this.#belowChunks[0].buffer.image, ctx);
    for (const { buffer, alpha } of shown) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = alpha;
      ctx.drawImage(buffer.image, 0, 0);
    }
    ctx.globalAlpha = 1;
    this.#underSeed = seed;
    return under;
  }

  /**
   * One ghost frame, from a pooled buffer. The neighbour model draws the
   * active layer alone; a history of visited frames flattens every layer the
   * selection covers into one ghost — which it is, the scene says.
   */
  #ghost(
    scene: FrameScene,
    { index: frame, tint }: GhostFrame,
    layers: readonly number[],
    width: number,
    height: number,
  ): { buffer: ComposeBuffer; key: string } | null {
    const cells: Frame[] = [];
    const keys: string[] = [];
    for (const index of layers) {
      const layer = scene.doc.layers[index];
      const cell = layer && frame < layer.frames.length ? resolveCell(layer, frame) : undefined;
      if (cell && !layer.hidden && (cell.raster || cell.strokes.length > 0)) {
        cells.push(cell);
        // The first and the last stroke too: undo one line and draw another,
        // and the cell and its count are what they were. A transform writes
        // fresh strokes (operations.ts `mapStrokes`), so it shows here as well.
        const image = cell.raster && scene.viewport.raster?.(cell.raster);
        const ink = cell.raster
          ? `${nodeId(cell.raster)}:${image ? nodeId(image) : ''}`
          : `${cell.strokes.length}:${nodeId(cell.strokes[0])}:${nodeId(cell.strokes[cell.strokes.length - 1])}`;
        keys.push(`${index}:${nodeId(layer)}:${nodeId(cell)}:${ink}`);
      }
    }
    if (cells.length === 0) {
      return null;
    }
    const { viewport } = scene;
    const key = keys.join('|')
      + `:${width}x${height}@${viewport.scale}:${viewport.panX}:${viewport.panY}:${tint ?? ''}`;
    const { buffer, fresh } = this.#ghosts.take(key);
    if (!fresh) {
      return { buffer, key };
    }
    // Layer by layer through the scratch, as the stack is: an eraser on one
    // layer must not cut the line of the layer under it in the ghost either.
    this.#paint(buffer, cells, { ...scene, tools: scene.doc.tools }, width, height, true);
    if (tint) {
      // Over what is there only: the lines take the colour and keep their alpha.
      const ctx = buffer.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';
    }
    return { buffer, key };
  }
}

/** A canvas that can be cut to a rectangle for a while. */
interface ClipCtx extends Canvas2DLike {
  save(): void;
  restore(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
}

/** A stroke's reach in document units: its points, out by its width. Kept per points array. */
const reaches = new WeakMap<readonly number[], { width: number; box: readonly [number, number, number, number] }>();
function reach(points: readonly number[], tool: unknown): readonly [number, number, number, number] {
  const width = (tool as { width?: number } | undefined)?.width ?? 0;
  const kept = reaches.get(points);
  if (kept && kept.width === width) {
    return kept.box;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]);
    maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    maxY = Math.max(maxY, points[i + 1]);
  }
  // The whole width out, not half: a stamp's shape and a pressure outline
  // reach as far, and a little more repainted costs nothing.
  const box = [minX - width, minY - width, maxX + width, maxY + width] as const;
  reaches.set(points, { width, box });
  return box;
}

/**
 * Strokes taken out of a cell whose pixels are on the buffer, the rest left in
 * their order: only the place they covered is cleared and drawn again, with
 * the strokes that reach into it. An undo of a small line in a cell of 900
 * drew all 900 (owner, 2026-11-14). False when it is not that, or the canvas
 * cannot clip, or the place is most of the buffer: then the cell is drawn whole.
 */
function repaintTaken(
  ctx: Canvas2DLike,
  cell: Frame,
  was: readonly unknown[],
  now: readonly unknown[],
  scene: FrameScene,
  width: number,
  height: number,
): boolean {
  const clipper = ctx as ClipCtx;
  if (typeof clipper.clip !== 'function' || now.length >= was.length) {
    return false;
  }
  // Removing even a distant separator can join two coats elsewhere on the sheet.
  if (was.some((part, index) => index % 3 === 1 && isFlatPaint(part as ToolDescriptor))) return false;
  // Was = now with some strokes taken out, the rest in the same order.
  let j = 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < was.length; i += 3) {
    if (j < now.length && was[i] === now[j] && was[i + 1] === now[j + 1] && was[i + 2] === now[j + 2]) {
      j += 3;
      continue;
    }
    const [a, b, c, d] = reach(was[i] as readonly number[], was[i + 1]);
    x0 = Math.min(x0, a);
    y0 = Math.min(y0, b);
    x1 = Math.max(x1, c);
    y1 = Math.max(y1, d);
  }
  if (j !== now.length || !Number.isFinite(x0)) {
    return false;
  }
  const { viewport } = scene;
  const k = viewport.scale * viewport.dpr;
  const ox = (viewport.panX ?? 0) * viewport.dpr;
  const oy = (viewport.panY ?? 0) * viewport.dpr;
  // Two pixels more a side for the smoothing of the edges.
  const left = Math.max(0, Math.floor(x0 * k + ox) - 2);
  const top = Math.max(0, Math.floor(y0 * k + oy) - 2);
  const right = Math.min(width, Math.ceil(x1 * k + ox) + 2);
  const bottom = Math.min(height, Math.ceil(y1 * k + oy) + 2);
  if (right <= left || bottom <= top) {
    return true; // nothing of it was on the buffer
  }
  if ((right - left) * (bottom - top) > width * height / 2) {
    return false;
  }
  const touching = cell.strokes.filter((stroke) => {
    const [a, b, c, d] = reach(stroke.points, scene.tools[stroke.tool_id]);
    return a * k + ox < right && c * k + ox > left && b * k + oy < bottom && d * k + oy > top;
  });
  clipper.save();
  try {
    clipper.setTransform(1, 0, 0, 1, 0, 0);
    clipper.beginPath();
    clipper.rect(left, top, right - left, bottom - top);
    clipper.clip();
    clipper.clearRect(left, top, right - left, bottom - top);
    renderStrokesLayer({ strokes: touching }, scene.tools, clipper, viewport, undefined, STUDIO_PATHS);
  } finally {
    clipper.restore();
  }
  return true;
}

/**
 * A stable id per layer or cell object. Keys built from indices and stroke
 * counts collide after a reorder, a paste of equal length or a document swap;
 * object identity does not.
 */
const nodeIds = new WeakMap<object, number>();
let nextNodeId = 0;
function nodeId(node: object): number {
  let id = nodeIds.get(node);
  if (id === undefined) {
    id = nextNodeId++;
    nodeIds.set(node, id);
  }
  return id;
}
