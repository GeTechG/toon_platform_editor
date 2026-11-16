import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Canvas2DFrameRenderer, renderStrokesLayer, type Canvas2DLike, type StrokePaths } from './canvas2d';
import { PathKeeper } from './path-keeper';
import type { Frame, ToolDescriptor } from '../format/types';

/** A Path2D that writes down what it was told, and how many were made. */
class FakePath {
  static made = 0;
  readonly log: string[] = [];
  constructor() { FakePath.made++; }
  moveTo(x: number, y: number) { this.log.push(`M${x},${y}`); }
  lineTo(x: number, y: number) { this.log.push(`L${x},${y}`); }
  quadraticCurveTo(a: number, b: number, x: number, y: number) { this.log.push(`Q${a},${b},${x},${y}`); }
  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) { this.log.push(`C${a},${b},${c},${d},${x},${y}`); }
  arc(x: number, y: number, r: number) { this.log.push(`A${x},${y},${r}`); }
}

/** A target that writes down every paint with the path it went over, straight or kept. */
function target() {
  const log: string[] = [];
  let current: string[] = [];
  const t = {
    canvas: { width: 100, height: 100 },
    globalCompositeOperation: 'source-over', globalAlpha: 1, lineWidth: 0,
    strokeStyle: '', fillStyle: '', lineCap: '', lineJoin: '',
    setTransform() {}, fillRect() {}, clearRect() {}, drawImage() {},
    beginPath() { current = []; },
    moveTo(x: number, y: number) { current.push(`M${x},${y}`); },
    lineTo(x: number, y: number) { current.push(`L${x},${y}`); },
    quadraticCurveTo(a: number, b: number, x: number, y: number) { current.push(`Q${a},${b},${x},${y}`); },
    bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) { current.push(`C${a},${b},${c},${d},${x},${y}`); },
    arc(x: number, y: number, r: number) { current.push(`A${x},${y},${r}`); },
    fill(path?: FakePath) { log.push(`fill ${t.fillStyle} ${(path?.log ?? current).join(' ')}`); },
    stroke(path?: FakePath) { log.push(`stroke ${t.strokeStyle} ${t.lineWidth} ${(path?.log ?? current).join(' ')}`); },
  };
  return { ctx: t as unknown as Canvas2DLike, log };
}

const pencil: ToolDescriptor = { kind: 'pencil', geometry: 'smooth', width: 40, color: '#112233' };
const feather = { kind: 'feather', geometry: 'smooth', width: 30, color: '#000000', fill: '#ff0000' } as ToolDescriptor;
const frame: Frame = {
  strokes: [
    { points: [0, 0, 100, 50, 200, 0, 300, 80], tool_id: 0 },
    { points: [10, 10, 60, 90, 120, 40], tool_id: 0, pressure: [100, 400, 900] },
    { points: [5, 5], tool_id: 0 },
    { points: [0, 0, 50, 50, 100, 0], tool_id: 1 },
  ],
};
const viewport = { scale: 1, dpr: 1 };
const paints = (log: string[]) => log;

describe('a stroke keeps its path', () => {
  const own = (globalThis as { Path2D?: unknown }).Path2D;
  beforeEach(() => { FakePath.made = 0; });
  afterEach(() => { (globalThis as { Path2D?: unknown }).Path2D = own; });

  it('paints what it painted without a kept path', () => {
    delete (globalThis as { Path2D?: unknown }).Path2D;
    const direct = target();
    renderStrokesLayer(frame, [pencil, feather], direct.ctx, viewport);
    (globalThis as { Path2D?: unknown }).Path2D = FakePath;
    const kept = target();
    renderStrokesLayer(frame, [pencil, feather], kept.ctx, viewport, undefined, new PathKeeper<StrokePaths>(1 << 20));
    expect(paints(kept.log)).toEqual(paints(direct.log));
  });

  it('builds the path of a stroke once, however often it is drawn', () => {
    (globalThis as { Path2D?: unknown }).Path2D = FakePath;
    const strokes: Frame = { strokes: frame.strokes.map((s) => ({ ...s, points: s.points.slice() })) };
    const keeper = new PathKeeper<StrokePaths>(1 << 20);
    renderStrokesLayer(strokes, [pencil, feather], target().ctx, viewport, undefined, keeper);
    const once = FakePath.made;
    expect(once).toBeGreaterThan(0);
    renderStrokesLayer(strokes, [pencil, feather], target().ctx, viewport, undefined, keeper);
    expect(FakePath.made).toBe(once);
  });

  it('keeps nothing unless told where: what draws a stroke once holds no paths', () => {
    (globalThis as { Path2D?: unknown }).Path2D = FakePath;
    const fresh = (): Frame => ({ strokes: frame.strokes.map((s) => ({ ...s, points: s.points.slice() })) });
    renderStrokesLayer(fresh(), [pencil, feather], target().ctx, viewport);
    expect(FakePath.made).toBe(0);
    const doc = {
      schema_version: 8, width: 800, height: 800, frame_rate: 12, tools: [pencil, feather],
      layers: [{ hidden: false, frames: [fresh()] }, { hidden: false, frames: [fresh()] }],
    } as const;
    const renderer = new Canvas2DFrameRenderer(() => target() as unknown as { ctx: Canvas2DLike; image: CanvasImageSource });
    renderer.render(doc as never, 0, target().ctx, viewport);
    expect(FakePath.made).toBe(0);
  });
});
