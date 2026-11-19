import { describe, expect, it } from 'bun:test';
import { addStroke, createDocument, addLayer, addFrame } from '../model/operations';
import type { ToonDocument } from '../format/types';
import { FrameComposer, type ComposeBuffer, type ComposeTarget } from './frame-compose';
import { CellWarmer, warmWay, type WarmCrew } from './cell-warm';
import { CellCache } from './cell-cache';

/**
 * Buffers and a target that write down what was drawn on them instead of
 * drawing it. The composer never touches a canvas itself — it takes the way to
 * make a buffer — so the whole of it runs here.
 */
class Recorder implements ComposeBuffer {
  readonly log: string[] = [];
  readonly image: CanvasImageSource;
  globalAlpha = 1;
  globalCompositeOperation = 'source-over' as GlobalCompositeOperation;
  lineWidth = 0;
  strokeStyle = '';
  fillStyle = '';
  lineCap = '';
  lineJoin = '';
  readonly canvas = { width: 0, height: 0 };

  constructor(readonly name: string) {
    this.image = { recorder: this } as unknown as CanvasImageSource;
  }

  get ctx(): ComposeTarget { return this as unknown as ComposeTarget; }

  size(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }
  clear(): void { this.log.push('clear'); }
  setTransform(): void {}
  fillRect(): void { this.log.push(`fillRect ${this.globalCompositeOperation} ${this.fillStyle}`); }
  clearRect(): void { this.log.push('clear'); }
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  quadraticCurveTo(): void {}
  bezierCurveTo(): void {}
  arc(): void {}
  stroke(): void { this.log.push(`stroke ${this.strokeStyle}`); }
  fill(): void { this.log.push(`fill ${this.fillStyle}`); }
  drawImage(image: CanvasImageSource): void {
    const from = (image as unknown as { recorder?: Recorder }).recorder;
    const op = this.globalCompositeOperation === 'source-over' ? '' : ` ~${this.globalCompositeOperation}`;
    this.log.push(`blit ${from?.name ?? '?'}${this.globalAlpha < 1 ? ` @${this.globalAlpha}` : ''}${op}`);
  }
}

/** Every buffer the composer asked for, in the order it asked. */
function composer() {
  const made: Recorder[] = [];
  const instance = new FrameComposer(() => {
    const buffer = new Recorder(`b${made.length}`);
    made.push(buffer);
    return buffer;
  });
  return { instance, made };
}

/** The buffer a ghost was painted into: the one blitted at the ghost's alpha. */
function ghostIn(made: readonly Recorder[], alpha = 0.3): Recorder {
  const entry = made.flatMap((buffer) => buffer.log).find((logged) => logged.endsWith(`@${alpha}`))!;
  return made.find((buffer) => buffer.name === entry.split(' ')[1])!;
}

/** The buffer that blitted `source` into itself. */
function holderOf(made: readonly Recorder[], source: Recorder): Recorder {
  return made.find((buffer) => buffer.log.some((logged) => logged.startsWith(`blit ${source.name}`)))!;
}

const line = (x: number) => ({ points: [x, 0, x, 400, x + 10, 800], width: 40, color: '#000000' });

function doc(layers: number): ToonDocument {
  const built = createDocument();
  for (let l = 1; l < layers; l++) addLayer(built, l);
  for (let l = 0; l < layers; l++) {
    addStroke(built, l, 0, line(100 * (l + 1)));
  }
  return built;
}

const viewport = { scale: 0.1, dpr: 1, panX: 0, panY: 0 };

describe('the composer stacks a frame', () => {
  it('blits the layers below the active one, then it, then the ones above', () => {
    const { instance } = composer();
    const target = new Recorder('target');
    instance.compose(target.ctx, 100, 50, {
      doc: doc(3), frame: 0, activeLayer: 1, viewport, tools: doc(3).tools,
    });
    // b0/b1/b2 are the stack buffers in the order the composer makes them:
    // below the active layer, the active layer, above it.
    expect(target.log).toEqual(['blit b0', 'blit b1', 'blit b2']);
  });

  it('draws a single live pencil stroke directly at its opacity', () => {
    const { instance, made } = composer();
    const built = doc(1);
    const flat = { kind: 'pencil', geometry: 'line', width: 4, color: '#ff8822', opacity: 50, buildup: false } as const;
    let paintedAt = 0;
    instance.compose(new Recorder('target').ctx, 100, 50, {
      doc: built, activeLayer: 0, frame: 0, tools: built.tools, viewport,
      live: { id: 1, flat, paint: (ctx) => { paintedAt = ctx.globalAlpha; ctx.stroke(); } },
    });
    expect(paintedAt).toBe(0.5);
    expect(made.some((buffer) => buffer.log.some((op) => op.endsWith('@0.5')))).toBe(false);
  });

  it('isolates a live feather when its line gains an interior', () => {
    const { instance } = composer();
    const doc = createDocument();
    const flat = { kind: 'feather', fill: '#112233', geometry: 'line', width: 8, color: '#ff8800', opacity: 50, buildup: false } as const;
    const points = [4, 4];
    const alphas: number[] = [];
    const scene = { doc, frame: 0, activeLayer: 0, tools: doc.tools, viewport,
      live: { id: 1, flat, points, paint: (ctx: ComposeTarget) => { alphas.push(ctx.globalAlpha); } } };
    const ctx = new Recorder('target').ctx;
    instance.compose(ctx, 20, 20, scene);
    points.push(8, 8, 12, 12);
    instance.compose(ctx, 20, 20, scene);
    points.push(4, 12);
    instance.compose(ctx, 20, 20, scene);
    expect(alphas).toEqual([0.5, 0.5, 1]);
  });

  it('paints a live crossing and its committed strokes at one opacity', () => {
    // Sample the intersection: every stroke in this scene covers this pixel.
    class Pixel extends Recorder {
      alpha = 0;
      clear() { this.alpha = 0; }
      clearRect() { this.clear(); }
      stroke() { this.alpha += (1 - this.alpha) * this.globalAlpha; }
      drawImage(image: CanvasImageSource) {
        const source = (image as unknown as { recorder: Pixel }).recorder;
        this.alpha += (1 - this.alpha) * source.alpha * this.globalAlpha;
      }
    }
    const composer = new FrameComposer(() => new Pixel(''));
    const target = new Pixel('');
    const doc = createDocument();
    const tool = { kind: 'pencil', geometry: 'line', width: 4, color: '#ff8822', opacity: 50, buildup: false } as const;
    const first = { points: [0, 10, 20, 10], tool };
    const crossing = { points: [10, 0, 10, 20], tool };
    const scene = { doc, frame: 0, activeLayer: 0, viewport, tools: doc.tools };
    addStroke(doc, 0, 0, first);
    composer.compose(target.ctx, 20, 20, { ...scene, live: {
      id: 1, flat: tool, paint: (ctx) => ctx.stroke(),
    } });
    expect(target.alpha).toBe(0.5);
    addStroke(doc, 0, 0, crossing);
    target.clear();
    composer.invalidate();
    composer.compose(target.ctx, 20, 20, scene);
    expect(target.alpha).toBe(0.5);
    addStroke(doc, 0, 0, { ...crossing, tool: { ...tool, color: '#0000ff' } });
    target.clear();
    composer.invalidate();
    composer.compose(target.ctx, 20, 20, scene);
    expect(target.alpha).toBe(0.75);
  });

  it('puts the ghosts between the layers below and the active one', () => {
    const built = doc(3);
    addFrame(built, 0);
    for (let l = 0; l < 3; l++) addStroke(built, l, 1, line(500 + l));
    const { instance, made } = composer();
    const target = new Recorder('target');
    instance.compose(target.ctx, 100, 50, {
      doc: built, frame: 1, activeLayer: 1, viewport, tools: built.tools,
      ghosts: { frames: [{ index: 0, alpha: 0.3 }], layers: [1] },
    });
    // The ghost lands over the layers below and under the active one, so it
    // never covers the line being drawn — flattened with those layers into
    // one buffer, which goes under the active one.
    const ghost = ghostIn(made);
    const under = holderOf(made, ghost);
    expect(under.log).toEqual(['clear', 'blit b0', `blit ${ghost.name} @0.3`]);
    expect(target.log).toEqual([`blit ${under.name}`, 'blit b1', 'blit b2']);
  });

  it('flattens layers that erase nothing straight into their buffer', () => {
    const built = doc(2);
    addFrame(built, 0);
    const { instance, made } = composer();
    const target = new Recorder('target');
    instance.compose(target.ctx, 100, 50, {
      doc: built, frame: 1, activeLayer: 0, viewport, tools: built.tools,
      ghosts: { frames: [{ index: 0, alpha: 0.3 }], layers: [0, 1] },
    });
    const ghost = ghostIn(made);
    // A buffer per layer was a clear and a blit of the whole sheet per layer.
    expect(ghost.log.filter((entry) => entry.startsWith('stroke'))).toHaveLength(2);
    expect(ghost.log.filter((entry) => entry.startsWith('blit'))).toEqual([]);
  });

  it('flattens a layer that erases apart from the one under it, so an eraser cuts only its own', () => {
    // The visited-frames onion flattens every selected layer into one ghost.
    // Drawn straight into it, an eraser on the upper layer punched a hole in
    // the lower one's line — in the ghost only, never on the frame itself.
    const built = doc(2);
    addStroke(built, 1, 0, { points: [0, 0, 400, 400], tool: { kind: 'eraser', geometry: 'smooth', width: 40 } });
    addFrame(built, 0);
    const { instance, made } = composer();
    const target = new Recorder('target');
    instance.compose(target.ctx, 100, 50, {
      doc: built, frame: 1, activeLayer: 0, viewport, tools: built.tools,
      ghosts: { frames: [{ index: 0, alpha: 0.3 }], layers: [0, 1] },
    });
    const ghost = ghostIn(made);
    expect(ghost.log.filter((entry) => entry.startsWith('stroke'))).toHaveLength(1);
    expect(ghost.log.filter((entry) => entry.startsWith('blit'))).toHaveLength(1);
  });

  it('composites the frame off-screen when it is blitted at an alpha of its own', () => {
    const { instance } = composer();
    const target = new Recorder('target');
    instance.compose(target.ctx, 100, 50, {
      doc: doc(2), frame: 0, activeLayer: 0, viewport, tools: doc(2).tools, alpha: 0.8,
    });
    // One blit onto the visible target, at the alpha; the stack went into the
    // composite buffer before it.
    expect(target.log).toEqual(['blit b3 @0.8']);
  });

  it('paints a tinted ghost in its tint over its own lines only', () => {
    const built = doc(1);
    addFrame(built, 0);
    const { instance, made } = composer();
    const target = new Recorder('target');
    instance.compose(target.ctx, 100, 50, {
      doc: built, frame: 1, activeLayer: 0, viewport, tools: built.tools,
      ghosts: { frames: [{ index: 0, alpha: 0.3, tint: '#00ff00' }], layers: [0] },
    });
    const ghost = ghostIn(made);
    expect(ghost.log.at(-1)).toBe('fillRect source-in #00ff00');
  });

  it('lays the blended frame over the ghosts, at its alpha', () => {
    const built = doc(1);
    addFrame(built, 0);
    addStroke(built, 0, 1, line(300));
    const { instance, made } = composer();
    const target = new Recorder('target');
    instance.compose(target.ctx, 100, 50, {
      doc: built, frame: 1, activeLayer: 0, viewport, tools: built.tools,
      ghosts: { frames: [{ index: 0, alpha: 0.3 }], layers: [0] }, alpha: 0.5, blend: true,
    });
    // The ghosts go under the whole frame, not into it: the layers below
    // stay in the frame and take its alpha.
    const under = holderOf(made, ghostIn(made));
    expect(under.log.filter((logged) => logged.startsWith('blit'))).toHaveLength(1);
    expect(target.log).toHaveLength(2);
    expect(target.log[0]).toBe(`blit ${under.name}`);
    expect(target.log[1]).toEndWith(' @0.5');
  });

  it('paints nothing again while the strokes of the frame are what they were', () => {
    const { instance, made } = composer();
    const target = new Recorder('target');
    const scene = { doc: doc(1), frame: 0, activeLayer: 0, viewport, tools: doc(1).tools };
    instance.compose(target.ctx, 100, 50, scene);
    const painted = made.map((buffer) => buffer.log.length);
    // Told the frame may have changed — a pan, a zoom, a write elsewhere in
    // the document — it looks, and finds the same strokes.
    instance.invalidate();
    instance.compose(target.ctx, 100, 50, scene);
    expect(made.map((buffer) => buffer.log.length)).toEqual(painted);
  });

  it('lays a finished stroke over its layer and leaves the other layers alone', () => {
    const built = doc(3);
    const { instance, made } = composer();
    const target = new Recorder('target');
    const scene = { doc: built, frame: 0, activeLayer: 1, viewport, tools: built.tools };
    instance.compose(target.ctx, 100, 50, scene);
    const [below, active, above] = made.map((buffer) => buffer.log.length);
    addStroke(built, 1, 0, line(900));
    instance.invalidate();
    instance.compose(target.ctx, 100, 50, { ...scene, tools: built.tools });
    // One stroke on top of what was there: no clear, no second look at the rest.
    expect(made[1].log.slice(active)).toEqual(['stroke #000000']);
    expect(made[0].log.length).toBe(below);
    expect(made[2].log.length).toBe(above);
  });

  it('paints the layer afresh when a stroke is taken back, and only that layer', () => {
    const built = doc(2);
    addStroke(built, 1, 0, line(900));
    const { instance, made } = composer();
    const target = new Recorder('target');
    const scene = { doc: built, frame: 0, activeLayer: 1, viewport, tools: built.tools };
    instance.compose(target.ctx, 100, 50, scene);
    const [below, active] = made.map((buffer) => buffer.log.length);
    built.layers[1].frames[0]!.strokes.pop();
    instance.invalidate();
    instance.compose(target.ctx, 100, 50, scene);
    expect(made[1].log.slice(active)).toEqual(['clear', 'stroke #000000']);
    expect(made[0].log.length).toBe(below);
  });

  it('paints the layer afresh when a stroke already on it was given other points', () => {
    // The distort brush writes new points into the stroke it shakes: the
    // stroke is the same object, in the same place, and is not the same line.
    const built = doc(2);
    const { instance, made } = composer();
    const target = new Recorder('target');
    const scene = { doc: built, frame: 0, activeLayer: 1, viewport, tools: built.tools };
    instance.compose(target.ctx, 100, 50, scene);
    const below = made[0].log.length;
    const shaken = built.layers[0].frames[0]!.strokes[0];
    shaken.points = shaken.points.map((value) => value + 8);
    instance.invalidate();
    instance.compose(target.ctx, 100, 50, scene);
    expect(made[0].log.slice(below)).toEqual(['clear', 'stroke #000000']);
  });
});

describe('the line under the hand', () => {
  const scene = (live: unknown) => ({
    doc: doc(1), frame: 0, activeLayer: 0, viewport, tools: doc(1).tools,
    live: live as never,
  });

  it('keeps the settled part on its buffer and adds to it', () => {
    const { instance, made } = composer();
    const target = new Recorder('target');
    const points: number[] = [0, 0];
    const live = () => ({ id: 1, points, geometry: 'smooth' as const, width: 40, color: '#000000' });
    for (let i = 1; i <= 12; i++) {
      points.push(i * 80, i * 40);
      instance.compose(target.ctx, 100, 50, scene(live()));
    }
    // The live buffer is seeded from the active layer once, not once a frame.
    const liveBuffer = made.find((b) => b.log.some((e) => e === 'blit b1' || e === 'blit b0'))!;
    const seeds = liveBuffer.log.filter((e) => e === 'clear').length;
    expect(seeds).toBe(1);
    // And the line kept being drawn onto it as it grew.
    expect(liveBuffer.log.filter((e) => e.startsWith('stroke')).length).toBeGreaterThan(1);
  });

  it('lets a line that cannot be added to paint itself, every frame', () => {
    const { instance } = composer();
    const target = new Recorder('target');
    let painted = 0;
    const live = { id: 1, erase: true, paint: () => { painted += 1; } };
    instance.compose(target.ctx, 100, 50, scene(live));
    instance.compose(target.ctx, 100, 50, scene(live));
    expect(painted).toBe(2);
  });

  it('costs a frame as many blits with the ghosts shown as without them', () => {
    // A layer whose neighbouring frames are drawn shows their ghosts, the one
    // beside it with empty neighbours none. Laid over the sheet one by one on
    // every frame of the stroke, they slowed the line on the first layer
    // alone, and under the same brush it trailed the hand there and not here.
    const built = doc(3);
    addFrame(built, 0);
    addFrame(built, 1);
    for (let l = 0; l < 3; l++) {
      addStroke(built, l, 1, line(300 + l));
      addStroke(built, l, 2, line(500 + l));
    }
    const ghosts = { frames: [{ index: 0, alpha: 0.3 }, { index: 2, alpha: 0.3 }], layers: [1] };
    const blitsPerFrame = (shown: boolean) => {
      const { instance, made } = composer();
      const target = new Recorder('target');
      const points: number[] = [0, 0];
      const blits: number[] = [];
      for (let i = 1; i <= 6; i++) {
        points.push(i * 80, i * 40);
        instance.compose(target.ctx, 100, 50, {
          doc: built, frame: 1, activeLayer: 1, viewport, tools: built.tools,
          ghosts: shown ? ghosts : undefined,
          live: { id: 1, points, geometry: 'smooth', width: 40, color: '#000000' },
        });
        const all = [...made.flatMap((b) => b.log), ...target.log];
        blits.push(all.filter((entry) => entry.startsWith('blit')).length);
      }
      // Every frame after the first, counted apart.
      return blits.slice(1).map((total, i) => total - blits[i]);
    };
    expect(blitsPerFrame(true)).toEqual(blitsPerFrame(false));
  });

  it('never asks a line to paint itself when it gave points to add', () => {
    const { instance } = composer();
    const target = new Recorder('target');
    let painted = 0;
    instance.compose(target.ctx, 100, 50, scene({
      id: 1, points: [0, 0, 80, 40, 160, 80, 240, 120], geometry: 'smooth', width: 40,
      color: '#000000', paint: () => { painted += 1; },
    }));
    // `paint` present means the line is drawn whole — the composer must not
    // silently prefer the points it was also handed.
    expect(painted).toBe(1);
  });
});

describe('the composer knows no brushes', () => {
  it('reaches for no tool, brush or plugin', async () => {
    // What a line paints is the brush's business: it arrives as points and a
    // geometry, or as its own way of painting itself.
    const source = await Bun.file(new URL('./frame-compose.ts', import.meta.url)).text();
    const imports = source.match(/^import[^;]*;/gm) ?? [];
    expect(imports.filter((line) => /'\.\.\/(tools|plugins)\//.test(line))).toEqual([]);
    expect(source).not.toContain('descriptor');
    expect(source).not.toContain('.kind');
  });
});

describe('the cell cache', () => {
  /** A composer that keeps rasterized cells, with room for plenty of them. */
  function cached(bytes = 64 * 1024 * 1024) {
    const made: Recorder[] = [];
    const instance = new FrameComposer(() => {
      const buffer = new Recorder(`b${made.length}`);
      made.push(buffer);
      return buffer;
    }, { cellBytes: bytes });
    return { instance, made };
  }
  /** Every line drawn in `colour` on any buffer since `from` (log lengths). */
  const drawnIn = (made: readonly Recorder[], colour: string, from: readonly number[] = []) =>
    made.flatMap((buffer, i) => buffer.log.slice(from[i] ?? 0)).filter((e) => e === `stroke ${colour}`).length;
  const lengths = (made: readonly Recorder[]) => made.map((buffer) => buffer.log.length);

  /** Two frames; layer 0 holds the same sketch in both, as a copy (a file read back). */
  function sketched(): ToonDocument {
    const built = doc(2);
    addFrame(built, 0);
    built.layers[0].frames[0]!.strokes = [];
    addStroke(built, 0, 0, { points: [0, 0, 400, 400, 800, 0], width: 40, color: '#123456' });
    addStroke(built, 0, 0, { points: [10, 10, 410, 410, 810, 10], width: 40, color: '#123456' });
    built.layers[0].frames[1] = structuredClone(built.layers[0].frames[0]!);
    addStroke(built, 1, 1, line(700));
    return built;
  }

  it('keeps no copy of a selection being moved: a move is not a cell to come back to', () => {
    const built = sketched();
    const { instance, made } = cached();
    const target = new Recorder('target');
    const own = built.layers[0].frames[0]!;
    let move: ((typeof own.strokes)[number])[] | null = null;
    const scene = {
      doc: built, frame: 0, activeLayer: 0, viewport, tools: built.tools,
      cellAt: (layer: number, frame: number) => (layer === 0 && frame === 0 && move
        ? { strokes: move }
        : built.layers[layer].frames[frame]!),
    };
    instance.compose(target.ctx, 100, 50, scene);
    for (let i = 1; i <= 2; i++) {
      move = own.strokes.map((stroke) => ({ ...stroke, place: [1, 0, 0, 1, 40 * i, 0] }));
      instance.invalidate();
      instance.compose(target.ctx, 100, 50, scene);
    }
    const buffers = made.length;
    for (let i = 3; i <= 6; i++) {
      move = own.strokes.map((stroke) => ({ ...stroke, place: [1, 0, 0, 1, 40 * i, 0] }));
      instance.invalidate();
      instance.compose(target.ctx, 100, 50, scene);
    }
    expect(made.length).toBe(buffers);
  });

  it('rasterizes a cell once when another frame holds the same strokes', () => {
    const built = sketched();
    const { instance, made } = cached();
    const target = new Recorder('target');
    const scene = { doc: built, frame: 0, activeLayer: 1, viewport, tools: built.tools };
    instance.compose(target.ctx, 100, 50, scene);
    expect(drawnIn(made, '#123456')).toBe(2);
    const before = lengths(made);
    instance.invalidate();
    instance.compose(target.ctx, 100, 50, { ...scene, frame: 1 });
    expect(drawnIn(made, '#123456', before)).toBe(0);
    // The layer that differs is drawn.
    expect(drawnIn(made, '#000000', before)).toBeGreaterThan(0);
  });
  it('lays a cell back from the cache when an undo makes it what it was', () => {
    const built = sketched();
    const { instance, made } = cached();
    const target = new Recorder('target');
    const scene = { doc: built, frame: 0, activeLayer: 0, viewport, tools: built.tools };
    instance.compose(target.ctx, 100, 50, scene);
    addStroke(built, 0, 0, line(900));
    instance.invalidate();
    instance.compose(target.ctx, 100, 50, { ...scene, tools: built.tools });
    const before = lengths(made);
    built.layers[0].frames[0]!.strokes.pop();
    instance.invalidate();
    instance.compose(target.ctx, 100, 50, scene);
    expect(drawnIn(made, '#123456', before)).toBe(0);
  });

  it('rasterizes a cell again when a stroke on it was given other points', () => {
    const built = sketched();
    const { instance, made } = cached();
    const target = new Recorder('target');
    const scene = { doc: built, frame: 0, activeLayer: 1, viewport, tools: built.tools };
    instance.compose(target.ctx, 100, 50, scene);
    const before = lengths(made);
    const shaken = built.layers[0].frames[0]!.strokes[0];
    shaken.points = shaken.points.map((value) => value + 8);
    instance.invalidate();
    instance.compose(target.ctx, 100, 50, scene);
    expect(drawnIn(made, '#123456', before)).toBe(2);
  });
  it('keeps no more cells than its budget holds, giving the oldest back', () => {
    const made: Recorder[] = [];
    // Room for one cell of 100×50 and no more.
    const cells = new CellCache(() => {
      const buffer = new Recorder(`c${made.length}`);
      made.push(buffer);
      return buffer;
    }, 100 * 50 * 4);
    const built = sketched();
    const [first, second] = [built.layers[0].frames[0]!, built.layers[1].frames[1]!];
    cells.take(first, built.tools, viewport, 100, 50, () => {});
    cells.take(second, built.tools, viewport, 100, 50, () => {});
    expect(cells.has(second, built.tools, viewport, 100, 50)).toBe(true);
    expect(cells.has(first, built.tools, viewport, 100, 50)).toBe(false);
    expect(made[0].canvas.width).toBe(0);
  });

  it('hands the kept pixels of a cell to whoever asks by its strokes alone, at whatever size they were kept', () => {
    const built = sketched();
    const { instance } = cached();
    instance.compose(new Recorder('target').ctx, 100, 50, { doc: built, frame: 0, activeLayer: 1, viewport, tools: built.tools });
    const copy = structuredClone(built.layers[0].frames[0]!);
    expect(instance.cells!.anyOf(copy, built.tools)).not.toBeNull();
    expect(instance.cells!.anyOf({ strokes: [] }, built.tools)).toBeNull();
  });

  it('lays a ghost from the same cells as the frame', () => {
    const built = sketched();
    const { instance, made } = cached();
    const target = new Recorder('target');
    instance.compose(target.ctx, 100, 50, { doc: built, frame: 0, activeLayer: 1, viewport, tools: built.tools });
    const before = lengths(made);
    instance.invalidate();
    instance.compose(target.ctx, 100, 50, {
      doc: built, frame: 1, activeLayer: 1, viewport, tools: built.tools,
      ghosts: { frames: [{ index: 0, alpha: 0.3 }], layers: [0] },
    });
    expect(drawnIn(made, '#123456', before)).toBe(0);
  });
});

describe('the cell drawn on stays ready', () => {
  function cachedComposer() {
    const made: Recorder[] = [];
    const instance = new FrameComposer(() => {
      const buffer = new Recorder(`b${made.length}`);
      made.push(buffer);
      return buffer;
    }, { cellBytes: 64 * 1024 * 1024 });
    return { instance, made };
  }
  const strokesSince = (made: readonly Recorder[], from: readonly number[]) =>
    made.flatMap((buffer, i) => buffer.log.slice(from[i] ?? 0)).filter((e) => e.startsWith('stroke'));

  it('is laid from the cache when the hand steps off it and it shows as a ghost', () => {
    const built = doc(1);
    addFrame(built, 0);
    addStroke(built, 0, 1, line(600));
    const { instance, made } = cachedComposer();
    const target = new Recorder('target');
    const scene = { doc: built, frame: 0, activeLayer: 0, viewport, tools: built.tools };
    instance.compose(target.ctx, 100, 50, scene);
    // Drawn on: the line lands on top of the layer, nothing else is redrawn.
    addStroke(built, 0, 0, { points: [0, 0, 300, 300], width: 40, color: '#00ff00' });
    instance.invalidate();
    instance.compose(target.ctx, 100, 50, { ...scene, tools: built.tools });
    const before = made.map((buffer) => buffer.log.length);
    instance.invalidate();
    instance.compose(target.ctx, 100, 50, {
      ...scene, tools: built.tools, frame: 1, ghosts: { frames: [{ index: 0, alpha: 0.3 }], layers: [0] },
    });
    // The ghost of the frame left is a copy of what the layer held, not drawn again.
    expect(strokesSince(made, before)).toEqual(['stroke #000000']);
  });

  it('a cell put whole on the layer, as a file opening does, goes through the cache', () => {
    const empty = createDocument();
    const { instance, made } = cachedComposer();
    const target = new Recorder('target');
    instance.compose(target.ctx, 100, 50, { doc: empty, frame: 0, activeLayer: 0, viewport, tools: empty.tools });
    const opened = doc(1);
    addFrame(opened, 0);
    for (let i = 0; i < 20; i++) addStroke(opened, 0, 1, line(10 * i));
    instance.invalidate();
    instance.compose(target.ctx, 100, 50, { doc: opened, frame: 1, activeLayer: 0, viewport, tools: opened.tools });
    const before = made.map((buffer) => buffer.log.length);
    instance.invalidate();
    instance.compose(target.ctx, 100, 50, {
      doc: opened, frame: 0, activeLayer: 0, viewport, tools: opened.tools,
      ghosts: { frames: [{ index: 1, alpha: 0.3 }], layers: [0] },
    });
    // Frame 0's own line is new here; frame 1, shown as a ghost, is not drawn again.
    expect(strokesSince(made, before)).toEqual(['stroke #000000']);
  });
});

describe('an undo repaints the place it took from', () => {
  /** A recorder that can clip, as a real canvas can. */
  class Clipper extends Recorder {
    save(): void { this.log.push('save'); }
    restore(): void { this.log.push('restore'); }
    rect(x: number, y: number, w: number, h: number): void { this.log.push(`rect ${x},${y},${w},${h}`); }
    clip(): void { this.log.push('clip'); }
  }

  it('draws again only the lines that touch the place of the stroke taken back', () => {
    const built = createDocument();
    const at = (x: number, colour: string) => ({ points: [x, 0, x + 100, 100], width: 40, color: colour });
    addStroke(built, 0, 0, at(0, '#aa0000'));
    addStroke(built, 0, 0, at(5000, '#00aa00'));
    addStroke(built, 0, 0, at(5050, '#0000aa'));
    addStroke(built, 0, 0, at(9000, '#aaaa00'));
    const made: Clipper[] = [];
    const instance = new FrameComposer(() => {
      const buffer = new Clipper(`b${made.length}`);
      made.push(buffer);
      return buffer;
    });
    const target = new Recorder('target');
    const scene = { doc: built, frame: 0, activeLayer: 0, viewport, tools: built.tools };
    instance.compose(target.ctx, 1000, 100, scene);
    const before = made.map((buffer) => buffer.log.length);
    built.layers[0].frames[0]!.strokes.splice(2, 1);
    instance.invalidate();
    instance.compose(target.ctx, 1000, 100, scene);
    const after = made.flatMap((buffer, i) => buffer.log.slice(before[i]));
    expect(after).toContain('clip');
    // The neighbour under the place is drawn again; the far ones are not.
    expect(after.filter((e) => e.startsWith('stroke'))).toEqual(['stroke #00aa00']);
  });
});

describe('neighbouring frames are rasterized ahead', () => {
  it('goes to workers where the browser draws in them, and stays on the page where not', () => {
    expect(warmWay({ worker: true, offscreen2d: true })).toBe('workers');
    expect(warmWay({ worker: true, offscreen2d: false })).toBe('page');
    expect(warmWay({ worker: false, offscreen2d: true })).toBe('page');
  });

  /** Five frames, each layer with lines of its own colour per frame. */
  function film(): ToonDocument {
    const built = doc(2);
    for (let f = 1; f < 5; f++) addFrame(built, f - 1);
    for (let f = 1; f < 5; f++) {
      for (let l = 0; l < 2; l++) {
        addStroke(built, l, f, { points: [f * 100, l * 100, f * 100 + 50, l * 100 + 50], width: 40, color: `#0${f}0${l}00` });
      }
    }
    return built;
  }

  function setup(crew?: WarmCrew) {
    const made: Recorder[] = [];
    const instance = new FrameComposer(() => {
      const buffer = new Recorder(`b${made.length}`);
      made.push(buffer);
      return buffer;
    }, { cellBytes: 64 * 1024 * 1024 });
    const tasks: (() => void)[] = [];
    const warmer = new CellWarmer(instance.cells!, (task) => {
      tasks.push(task);
      return () => { const i = tasks.indexOf(task); if (i >= 0) tasks.splice(i, 1); };
    }, crew);
    const runAll = async () => {
      while (tasks.length > 0) {
        tasks.shift()!();
        await Bun.sleep(0);
      }
    };
    return { instance, made, warmer, tasks, runAll };
  }
  const strokesSince = (made: readonly Recorder[], from: readonly number[]) =>
    made.flatMap((buffer, i) => buffer.log.slice(from[i] ?? 0)).filter((e) => e.startsWith('stroke')).length;

  it('on the page: the next frame is drawn from what idle time rasterized', async () => {
    const built = film();
    const { instance, made, warmer, runAll } = setup();
    const target = new Recorder('target');
    const scene = { doc: built, frame: 2, activeLayer: 1, viewport, tools: built.tools };
    instance.compose(target.ctx, 100, 50, scene);
    warmer.request({ doc: built, frame: 2, tools: built.tools, viewport, width: 100, height: 50 });
    await runAll();
    const before = made.map((buffer) => buffer.log.length);
    instance.invalidate();
    instance.compose(target.ctx, 100, 50, { ...scene, frame: 3 });
    expect(strokesSince(made, before)).toBe(0);
  });

  it('in workers: the cells come back as pixels and are laid from there', async () => {
    const built = film();
    const asked: number[] = [];
    const crew: WarmCrew = {
      draw: async (job) => {
        asked.push(job.strokes.length);
        return { image: { worker: true } as unknown as CanvasImageSource, free: () => {} };
      },
    };
    const { instance, made, warmer, runAll } = setup(crew);
    const target = new Recorder('target');
    const scene = { doc: built, frame: 2, activeLayer: 1, viewport, tools: built.tools };
    instance.compose(target.ctx, 100, 50, scene);
    warmer.request({ doc: built, frame: 2, tools: built.tools, viewport, width: 100, height: 50 });
    await runAll();
    expect(asked.length).toBeGreaterThan(0);
    const before = made.map((buffer) => buffer.log.length);
    instance.invalidate();
    instance.compose(target.ctx, 100, 50, { ...scene, frame: 1 });
    expect(strokesSince(made, before)).toBe(0);
  });

  it('during a playback, makes ready as many frames ahead as the window holds', async () => {
    const built = film();
    const asked: number[] = [];
    const crew: WarmCrew = {
      draw: async (job) => {
        asked.push(job.strokes.length);
        return { image: { worker: true } as unknown as CanvasImageSource, free: () => {} };
      },
    };
    const { warmer, runAll } = setup(crew);
    // Frames 1 to 4 ahead of the empty first one, two layers each.
    warmer.request({ doc: built, frame: 0, tools: built.tools, viewport, width: 100, height: 50, ahead: 4 });
    await runAll();
    expect(asked.length).toBe(8);
  });

  it('drops what it had not done yet when told to stop', async () => {
    const built = film();
    const { warmer, tasks } = setup();
    warmer.request({ doc: built, frame: 2, tools: built.tools, viewport, width: 100, height: 50 });
    expect(tasks.length).toBeGreaterThan(0);
    warmer.stop();
    expect(tasks.length).toBe(0);
  });
});

describe('a selection moved by a matrix', () => {
  it('repaints the active layer when only the matrix changed, and leaves it when nothing did', () => {
    const built = doc(1);
    const own = built.layers[0].frames[0]!;
    const { instance, made } = composer();
    const target = new Recorder('target');
    let place = [1, 0, 0, 1, 40, 0];
    const scene = {
      doc: built, frame: 0, activeLayer: 0, viewport, tools: built.tools,
      cellAt: () => ({ strokes: own.strokes.map((stroke) => ({ ...stroke, place })) }),
    };
    instance.compose(target.ctx, 100, 50, scene);
    const active = made[1];
    const strokes = () => active.log.filter((entry) => entry.startsWith('stroke')).length;
    const first = strokes();
    expect(first).toBe(1);
    place = [1, 0, 0, 1, 80, 0];
    instance.invalidate();
    instance.compose(target.ctx, 100, 50, scene);
    expect(strokes()).toBe(2);
    instance.invalidate();
    instance.compose(target.ctx, 100, 50, scene);
    expect(strokes()).toBe(2);
  });
});

describe('a moved selection taken away', () => {
  it('repaints the whole layer, not the place the strokes stood before the move', () => {
    // The area repaint reads where a stroke stood from its points; a moved
    // one is drawn elsewhere by its matrix, and Delete left it on the canvas.
    class Clipping extends Recorder {
      save(): void {}
      restore(): void {}
      rect(): void {}
      clip(): void { this.log.push('clip'); }
    }
    const made: Recorder[] = [];
    const instance = new FrameComposer(() => {
      const buffer = new Clipping(`b${made.length}`);
      made.push(buffer);
      return buffer;
    });
    const built = doc(1);
    addStroke(built, 0, 0, line(600));
    const own = built.layers[0].frames[0]!;
    const target = new Recorder('target');
    // The first stroke is not selected; the second is moved far off.
    let shown = { strokes: [own.strokes[0], { ...own.strokes[1], place: [1, 0, 0, 1, 2000, 0] }] };
    const scene = { doc: built, frame: 0, activeLayer: 0, viewport, tools: built.tools, cellAt: () => shown };
    instance.compose(target.ctx, 100, 50, scene);
    const active = made[1];
    const from = active.log.length;
    // Delete: the moved strokes go, one is left where it was.
    shown = { strokes: [own.strokes[0]] } as typeof shown;
    instance.invalidate();
    instance.compose(target.ctx, 100, 50, scene);
    const after = active.log.slice(from);
    expect(after).not.toContain('clip');
    expect(after[0]).toBe('clear');
  });
});

describe('the composer lays each layer with its look', () => {
  const paper = '#ffffff';
  const named = (made: readonly Recorder[], name: string) => made.find((buffer) => buffer.name === name)!;
  /** The buffers whose blit onto `into` carries `suffix`. */
  const laidWith = (into: Recorder, suffix: string) => into.log.filter((entry) => entry.startsWith('blit') && entry.endsWith(suffix));

  it('lays a translucent active layer at its opacity, with the line under the hand in it', () => {
    const built = doc(2);
    built.layers[1].opacity = 50;
    const { instance, made } = composer();
    const target = new Recorder('target');
    instance.compose(target.ctx, 100, 50, {
      doc: built, frame: 0, activeLayer: 1, viewport, tools: built.tools, paper,
      live: { id: 1, points: [0, 0, 100, 100, 200, 200, 300, 300, 400, 400, 500, 500, 600, 600, 700, 700], width: 40, color: '#ff0000' },
    });
    // The tail is not painted over the frame at full strength: it is in the layer.
    expect(target.log.some((entry) => entry.startsWith('stroke'))).toBe(false);
    const [laid] = laidWith(target, ' @0.5');
    expect(laid).toBeDefined();
    const look = named(made, laid.split(' ')[1]);
    expect(look.log.some((entry) => entry.startsWith('stroke #ff0000'))).toBe(true);
    // Opacity alone asks for no paper.
    expect(target.log.some((entry) => entry.startsWith('fillRect'))).toBe(false);
  });

  it('a plain active layer still has the tail painted straight over the frame', () => {
    const built = doc(2);
    const { instance } = composer();
    const target = new Recorder('target');
    instance.compose(target.ctx, 100, 50, {
      doc: built, frame: 0, activeLayer: 1, viewport, tools: built.tools, paper,
      live: { id: 1, points: [0, 0, 100, 100], width: 40, color: '#ff0000' },
    });
    expect(target.log.some((entry) => entry.startsWith('stroke #ff0000'))).toBe(true);
  });

  it('keeps a translucent layer below the active one in the one buffer below, laid apart inside it', () => {
    const built = doc(3);
    built.layers[0].opacity = 40;
    const { instance, made } = composer();
    const target = new Recorder('target');
    instance.compose(target.ctx, 100, 50, { doc: built, frame: 0, activeLayer: 2, viewport, tools: built.tools, paper });
    expect(target.log).toEqual(['blit b0', 'blit b1']);
    expect(laidWith(named(made, 'b0'), ' @0.4')).toHaveLength(1);
  });

  it('lays a blended layer above the active one over the paper and everything under it, apart from the plain ones', () => {
    const built = doc(3);
    built.layers[2].blend = 'multiply';
    const { instance } = composer();
    const target = new Recorder('target');
    instance.compose(target.ctx, 100, 50, { doc: built, frame: 0, activeLayer: 0, viewport, tools: built.tools, paper });
    // Paper, the active layer, the plain layer above it, then the multiplied one onto all of that.
    expect(target.log[0]).toBe('fillRect source-over #ffffff');
    const blits = target.log.filter((entry) => entry.startsWith('blit'));
    expect(blits).toHaveLength(3);
    expect(blits[2]).toEndWith(' ~multiply');
    expect(blits.slice(0, 2).every((entry) => !entry.includes('~'))).toBe(true);
  });

  it('lays a blended layer below the active one over the paper, not inside a transparent buffer', () => {
    const built = doc(3);
    built.layers[1].blend = 'screen';
    const { instance } = composer();
    const target = new Recorder('target');
    instance.compose(target.ctx, 100, 50, { doc: built, frame: 0, activeLayer: 2, viewport, tools: built.tools, paper });
    expect(target.log[0]).toBe('fillRect source-over #ffffff');
    const blits = target.log.filter((entry) => entry.startsWith('blit'));
    expect(blits.map((entry) => entry.endsWith(' ~screen'))).toEqual([false, true, false]);
  });

  it('lays the paper under no blend while the onion shows through the frame', () => {
    const built = doc(2);
    built.layers[1].blend = 'multiply';
    const { instance } = composer();
    const target = new Recorder('target');
    instance.compose(target.ctx, 100, 50, {
      doc: built, frame: 0, activeLayer: 0, viewport, tools: built.tools, paper, alpha: 0.5, blend: true,
    });
    expect(target.log.some((entry) => entry.startsWith('fillRect'))).toBe(false);
  });

  it('paints a layer again when its look changes', () => {
    const built = doc(2);
    const { instance, made } = composer();
    const target = new Recorder('target');
    const scene = { doc: built, frame: 0, activeLayer: 1, viewport, tools: built.tools, paper };
    instance.compose(target.ctx, 100, 50, scene);
    built.layers[0].opacity = 30;
    instance.invalidate();
    instance.compose(target.ctx, 100, 50, scene);
    expect(laidWith(named(made, 'b0'), ' @0.3')).toHaveLength(1);
  });

  it('draws the ghosts without the looks of their layers', () => {
    const built = doc(1);
    built.layers[0].opacity = 20;
    addFrame(built, 0);
    addStroke(built, 0, 1, line(300));
    const { instance, made } = composer();
    const target = new Recorder('target');
    instance.compose(target.ctx, 100, 50, {
      doc: built, frame: 1, activeLayer: 0, viewport, tools: built.tools, paper,
      ghosts: { frames: [{ index: 0, alpha: 0.3 }], layers: [0] },
    });
    const ghost = ghostIn(made);
    expect(ghost.log.some((entry) => entry.includes('@0.2'))).toBe(false);
  });
});

