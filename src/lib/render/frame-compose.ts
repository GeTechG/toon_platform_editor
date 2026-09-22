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

import type { Frame, ToolDescriptor, ToonDocument } from '../format/types';
import { BufferRing } from '../ui/buffer-ring';
import { blitLayer, renderLivePart, renderStrokesLayer, type Canvas2DLike } from './canvas2d';
import type { Viewport } from './contract';
import type { StrokeGeometry } from './smoothing';

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

/** A ghost frame: which frame, and how strongly it shows. */
export interface GhostFrame {
  readonly index: number;
  readonly alpha: number;
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
  /** Paints the line whole onto a target. Absent means it can be added to. */
  readonly paint?: (target: Canvas2DLike) => void;
  /** The points of a line that can be added to, and how they are read. */
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
}

/** At most the onion depth on each side, so a handful of cells. */
const GHOST_BUFFERS = 4;

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
  #below: ComposeBuffer | undefined;
  #active: ComposeBuffer | undefined;
  #above: ComposeBuffer | undefined;
  /** One layer is rasterized here before it lands on a stack buffer. */
  #scratch: ComposeBuffer | undefined;
  /** The active layer plus the settled part of the line under the hand. */
  #live: ComposeBuffer | undefined;
  /** The whole frame, when it is blitted at an alpha below one. */
  #composite: ComposeBuffer | undefined;
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

  constructor(make: BufferFactory = domBuffer) {
    this.#make = make;
    this.#ghosts = new BufferRing(GHOST_BUFFERS, make);
  }

  /** The document, the frame or the view changed: the stack is stale. */
  invalidate(): void {
    this.#stale = true;
  }

  /**
   * The three buffers of the stack as they were last composed, for a caller
   * that has to read the frame back rather than show it — the pipette takes
   * the colour of the canvas off them. Null before the first frame.
   */
  get layers(): { below: CanvasImageSource; active: CanvasImageSource; above: CanvasImageSource } | null {
    return this.#below && this.#active && this.#above
      ? { below: this.#below.image, active: this.#active.image, above: this.#above.image }
      : null;
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
    if (alpha < 1) {
      // The profile's alpha applies to the whole frame, so the stack has to be
      // composited before it is blitted rather than layer by layer.
      const composite = (this.#composite ??= this.#make());
      composite.size(width, height);
      composite.clear();
      const cctx = composite.ctx as ComposeTarget;
      blitLayer(this.#below!.image, cctx);
      this.#drawGhosts(cctx, scene, width, height);
      blitLayer(active.image, cctx);
      this.#paintLiveTail(cctx, scene);
      blitLayer(this.#above!.image, cctx);
      target.globalAlpha = alpha;
      blitLayer(composite.image, target);
      target.globalAlpha = 1;
      return;
    }
    blitLayer(this.#below!.image, target);
    this.#drawGhosts(target, scene, width, height);
    blitLayer(active.image, target);
    this.#paintLiveTail(target, scene);
    blitLayer(this.#above!.image, target);
  }

  /** Rasterizes the frame into the three buffers of the stack. */
  #rebuild(scene: FrameScene, width: number, height: number): void {
    const layers = scene.doc.layers;
    const below: Frame[] = [];
    const above: Frame[] = [];
    for (let l = 0; l < layers.length; l++) {
      const cell = this.#cell(scene, l);
      if (!cell || layers[l].hidden || l === scene.activeLayer) {
        continue;
      }
      (l < scene.activeLayer ? below : above).push(cell);
    }
    this.#below ??= this.#make();
    this.#active ??= this.#make();
    this.#above ??= this.#make();
    this.#paint(this.#below, below, scene, width, height);
    this.#paint(this.#above, above, scene, width, height);
    const cell = this.#cell(scene, scene.activeLayer);
    const visible = cell && !layers[scene.activeLayer]?.hidden ? [cell] : [];
    this.#paint(this.#active, visible, scene, width, height);
    this.#serial += 1;
  }

  #cell(scene: FrameScene, layer: number): Frame | undefined {
    return scene.cellAt
      ? scene.cellAt(layer, scene.frame)
      : scene.doc.layers[layer]?.frames[scene.frame];
  }

  /** Rasterizes `cells` into a transparent buffer, bottom-up. */
  #paint(
    buffer: ComposeBuffer,
    cells: readonly Frame[],
    scene: FrameScene,
    width: number,
    height: number,
  ): void {
    buffer.size(width, height);
    buffer.clear();
    if (cells.length === 1) {
      // A single layer cannot bleed into another — rasterize it in place.
      renderStrokesLayer(cells[0], scene.tools, buffer.ctx, scene.viewport);
      return;
    }
    for (const cell of cells) {
      // Each layer rasterizes into its own scratch first, so an eraser cuts
      // only its own layer — then the scratch lands on the stack buffer.
      const scratch = (this.#scratch ??= this.#make());
      scratch.size(width, height);
      scratch.clear();
      renderStrokesLayer(cell, scene.tools, scratch.ctx, scene.viewport);
      blitLayer(scratch.image, buffer.ctx);
    }
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
    if (live.paint) {
      reseed();
      this.#liveSeed = '';
      this.#livePainted = 0;
      ctx.globalCompositeOperation = live.erase ? 'destination-out' : 'source-over';
      live.paint(ctx);
      ctx.globalCompositeOperation = 'source-over';
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
   * Blits the ghosts. They sit where the active layer sits in the stack — over
   * the layers below it, under the active one and everything above — so a
   * ghost never covers the line being drawn.
   */
  #drawGhosts(target: ComposeTarget, scene: FrameScene, width: number, height: number): void {
    const ghosts = scene.ghosts;
    if (!ghosts || ghosts.frames.length === 0) {
      return;
    }
    for (const ghost of ghosts.frames) {
      const buffer = this.#ghost(scene, ghost.index, ghosts.layers, width, height);
      if (!buffer) {
        continue;
      }
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.globalAlpha = ghost.alpha;
      target.drawImage(buffer.image, 0, 0);
    }
    target.globalAlpha = 1;
  }

  /**
   * One ghost frame, from a pooled buffer. The neighbour model draws the
   * active layer alone; a history of visited frames flattens every layer the
   * selection covers into one ghost — which it is, the scene says.
   */
  #ghost(
    scene: FrameScene,
    frame: number,
    layers: readonly number[],
    width: number,
    height: number,
  ): ComposeBuffer | null {
    const cells: Frame[] = [];
    const keys: string[] = [];
    for (const index of layers) {
      const layer = scene.doc.layers[index];
      const cell = layer?.frames[frame];
      if (cell && !layer.hidden && cell.strokes.length > 0) {
        cells.push(cell);
        keys.push(`${index}:${nodeId(layer)}:${nodeId(cell)}:${cell.strokes.length}`);
      }
    }
    if (cells.length === 0) {
      return null;
    }
    const { viewport } = scene;
    const key = keys.join('|')
      + `:${width}x${height}@${viewport.scale}:${viewport.panX}:${viewport.panY}`;
    const { buffer, fresh } = this.#ghosts.take(key);
    if (!fresh) {
      return buffer;
    }
    buffer.size(width, height);
    buffer.clear();
    for (const cell of cells) {
      renderStrokesLayer(cell, scene.doc.tools, buffer.ctx, viewport);
    }
    return buffer;
  }
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
