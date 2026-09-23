import { describe, expect, it } from 'bun:test';
import { addStroke, createDocument, addLayer, addFrame } from '../model/operations';
import type { ToonDocument } from '../format/types';
import { FrameComposer, type ComposeBuffer, type ComposeTarget } from './frame-compose';

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
  fillRect(): void {}
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
    this.log.push(`blit ${from?.name ?? '?'}${this.globalAlpha < 1 ? ` @${this.globalAlpha}` : ''}`);
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

  it('puts the ghosts between the layers below and the active one', () => {
    const built = doc(2);
    addFrame(built, 0);
    addStroke(built, 0, 1, line(500));
    const { instance } = composer();
    const target = new Recorder('target');
    instance.compose(target.ctx, 100, 50, {
      doc: built, frame: 1, activeLayer: 0, viewport, tools: built.tools,
      ghosts: { frames: [{ index: 0, alpha: 0.3 }], layers: [0] },
    });
    // The ghost lands over the layers below and under the active one, so it
    // never covers the line being drawn.
    expect(target.log).toEqual(['blit b0', 'blit b3 @0.3', 'blit b1', 'blit b2']);
  });

  it('flattens a ghost of several layers one layer at a time, so an eraser cuts only its own', () => {
    // The visited-frames onion flattens every selected layer into one ghost.
    // Drawn straight into it, an eraser on the upper layer punched a hole in
    // the lower one's line — in the ghost only, never on the frame itself.
    const built = doc(2);
    addFrame(built, 0);
    const { instance, made } = composer();
    const target = new Recorder('target');
    instance.compose(target.ctx, 100, 50, {
      doc: built, frame: 1, activeLayer: 0, viewport, tools: built.tools,
      ghosts: { frames: [{ index: 0, alpha: 0.3 }], layers: [0, 1] },
    });
    const ghostName = target.log.find((entry) => entry.includes('@0.3'))!.split(' ')[1];
    const ghost = made.find((buffer) => buffer.name === ghostName)!;
    expect(ghost.log.filter((entry) => entry.startsWith('stroke'))).toEqual([]);
    expect(ghost.log.filter((entry) => entry.startsWith('blit'))).toHaveLength(2);
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

  it('rebuilds the stack only when it is told the frame went stale', () => {
    const { instance, made } = composer();
    const target = new Recorder('target');
    const scene = { doc: doc(1), frame: 0, activeLayer: 0, viewport, tools: doc(1).tools };
    instance.compose(target.ctx, 100, 50, scene);
    const painted = made[0].log.filter((entry) => entry === 'clear').length;
    instance.compose(target.ctx, 100, 50, scene);
    expect(made[0].log.filter((entry) => entry === 'clear').length).toBe(painted);
    instance.invalidate();
    instance.compose(target.ctx, 100, 50, scene);
    expect(made[0].log.filter((entry) => entry === 'clear').length).toBeGreaterThan(painted);
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
