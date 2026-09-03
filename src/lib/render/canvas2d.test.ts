import { describe, expect, it } from 'bun:test';
import { canonicalize } from '../format/canonical';
import type { Frame, ToonDocument, ToolDescriptor } from '../format/types';
import {
  Canvas2DFrameRenderer,
  renderRawPolyline,
  renderStrokesLayer,
  type Canvas2DLike,
} from './canvas2d';

/** Recording context: journals every command and property assignment. */
class RecordingCtx implements Canvas2DLike {
  log: string[] = [];
  canvas = { width: 1200, height: 600 };
  #props: Record<string, unknown> = {};

  get globalCompositeOperation(): GlobalCompositeOperation {
    return (this.#props.globalCompositeOperation as GlobalCompositeOperation) ?? 'source-over';
  }
  set globalCompositeOperation(v: GlobalCompositeOperation) {
    this.#props.globalCompositeOperation = v;
    this.log.push(`globalCompositeOperation=${v}`);
  }
  get lineWidth(): number {
    return this.#props.lineWidth as number;
  }
  set lineWidth(v: number) {
    this.#props.lineWidth = v;
    this.log.push(`lineWidth=${v}`);
  }
  get strokeStyle(): string {
    return this.#props.strokeStyle as string;
  }
  set strokeStyle(v: string) {
    this.#props.strokeStyle = v;
    this.log.push(`strokeStyle=${v}`);
  }
  get fillStyle(): string {
    return this.#props.fillStyle as string;
  }
  set fillStyle(v: string) {
    this.#props.fillStyle = v;
    this.log.push(`fillStyle=${v}`);
  }
  get lineCap(): string {
    return this.#props.lineCap as string;
  }
  set lineCap(v: string) {
    this.#props.lineCap = v;
    this.log.push(`lineCap=${v}`);
  }
  get lineJoin(): string {
    return this.#props.lineJoin as string;
  }
  set lineJoin(v: string) {
    this.#props.lineJoin = v;
    this.log.push(`lineJoin=${v}`);
  }

  setTransform(...args: number[]): void {
    this.log.push(`setTransform(${args.join(',')})`);
  }
  fillRect(...args: number[]): void {
    this.log.push(`fillRect(${args.join(',')})`);
  }
  beginPath(): void {
    this.log.push('beginPath()');
  }
  arc(...args: number[]): void {
    this.log.push(`arc(${args.join(',')})`);
  }
  stroke(): void {
    this.log.push('stroke()');
  }
  fill(): void {
    this.log.push('fill()');
  }
  moveTo(x: number, y: number): void {
    this.log.push(`moveTo(${x},${y})`);
  }
  lineTo(x: number, y: number): void {
    this.log.push(`lineTo(${x},${y})`);
  }
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.log.push(`quadraticCurveTo(${cpx},${cpy},${x},${y})`);
  }
}

/** Small deterministic test rasterizer used only to freeze representative pixels. */
class RasterCtx implements Canvas2DLike {
  canvas = { width: 600, height: 300 };
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  lineWidth = 1;
  strokeStyle = '#000000';
  fillStyle = '#000000';
  lineCap = 'round';
  lineJoin = 'round';
  readonly pixels = new Uint32Array(this.canvas.width * this.canvas.height);
  #scale = 1;
  #path: Array<[number, number]> = [];
  #arc: [number, number, number] | undefined;

  setTransform(a: number): void {
    this.#scale = a;
  }
  fillRect(x: number, y: number, width: number, height: number): void {
    const color = rgba(this.fillStyle);
    for (let py = Math.max(0, y); py < Math.min(this.canvas.height, y + height); py++) {
      this.pixels.fill(color, py * this.canvas.width + Math.max(0, x), py * this.canvas.width + Math.min(this.canvas.width, x + width));
    }
  }
  beginPath(): void {
    this.#path = [];
    this.#arc = undefined;
  }
  arc(x: number, y: number, radius: number): void {
    this.#arc = [x * this.#scale, y * this.#scale, radius * this.#scale];
  }
  moveTo(x: number, y: number): void {
    this.#path.push([x * this.#scale, y * this.#scale]);
  }
  lineTo(x: number, y: number): void {
    this.#path.push([x * this.#scale, y * this.#scale]);
  }
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    const control: [number, number] = [cpx * this.#scale, cpy * this.#scale];
    if (this.#path.length === 0) this.#path.push(control);
    const start = this.#path.at(-1)!;
    const end: [number, number] = [x * this.#scale, y * this.#scale];
    for (let step = 1; step <= 64; step++) {
      const t = step / 64;
      const u = 1 - t;
      this.#path.push([
        u * u * start[0] + 2 * u * t * control[0] + t * t * end[0],
        u * u * start[1] + 2 * u * t * control[1] + t * t * end[1],
      ]);
    }
  }
  stroke(): void {
    const radius = (this.lineWidth * this.#scale) / 2;
    for (let i = 1; i < this.#path.length; i++) {
      this.#drawSegment(this.#path[i - 1], this.#path[i], radius, rgba(this.strokeStyle));
    }
  }
  fill(): void {
    if (this.#arc) this.#drawDisc(...this.#arc, rgba(this.fillStyle));
  }
  signature(): string {
    let hash = 2166136261;
    for (const pixel of this.pixels) {
      hash = Math.imul(hash ^ pixel, 16777619);
    }
    return `${this.canvas.width}x${this.canvas.height}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }
  #drawSegment(from: [number, number], to: [number, number], radius: number, color: number): void {
    const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) * 2));
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      this.#drawDisc(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, radius, color);
    }
  }
  #drawDisc(cx: number, cy: number, radius: number, color: number): void {
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(this.canvas.width - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(this.canvas.height - 1, Math.ceil(cy + radius));
    const radiusSquared = radius * radius;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= radiusSquared) {
          this.pixels[y * this.canvas.width + x] = color;
        }
      }
    }
  }
}

function rgba(color: string): number {
  const rgb = Number.parseInt(color.slice(1), 16);
  return (0xff000000 | rgb) >>> 0;
}

const renderer = new Canvas2DFrameRenderer();
const viewport = { scale: 0.125, dpr: 2 };
const sampleTools: ToolDescriptor[] = [
  { kind: 'pencil', dialect: 'multator', width: 32, color: '#000000' },
  { kind: 'pencil', dialect: 'multator', width: 160, color: '#ff3300' },
  { kind: 'pencil', dialect: 'multator', width: 16, color: '#00aa55' },
];

function sampleDoc(): ToonDocument {
  return {
    schema_version: 2,
    width: 4800,
    height: 2400,
    frame_rate: 12,
    tools: sampleTools,
    frames: [
      {
        strokes: [
          { points: [0, 0, 2400, 1200, 4800, 2400], tool_id: 0 },
          { points: [100, 100], tool_id: 1 },
          { points: [4800, 0, 0, 2400], tool_id: 2 },
        ],
      },
    ],
  };
}

function renderToLog(frame: Frame): string[] {
  const ctx = new RecordingCtx();
  renderer.render(frame, sampleTools, ctx, viewport);
  return ctx.log;
}

describe('Canvas2DFrameRenderer', () => {
  it('empty frame: clears the background, no strokes, no errors', () => {
    const log = renderToLog({ strokes: [] });
    expect(log).toEqual([
      'setTransform(1,0,0,1,0,0)',
      'fillStyle=#ffffff',
      'fillRect(0,0,1200,600)',
      'setTransform(0.25,0,0,0.25,0,0)',
    ]);
  });

  it('draws strokes in order with their attributes', () => {
    const log = renderToLog(sampleDoc().frames[0]).join('\n');
    const black = log.indexOf('strokeStyle=#000000');
    const red = log.indexOf('fillStyle=#ff3300'); // dot → fill
    const green = log.indexOf('strokeStyle=#00aa55');
    expect(black).toBeGreaterThan(-1);
    expect(red).toBeGreaterThan(black);
    expect(green).toBeGreaterThan(red);
    expect(log).toContain('lineWidth=32');
    expect(log).toContain('lineWidth=16');
    expect(log).toContain('arc(100,100,80,0,'); // radius = width/2
  });

  it('applies scale and dpr in the transform (document units → device px)', () => {
    const ctx = new RecordingCtx();
    renderer.render({ strokes: [] }, sampleTools, ctx, { scale: 0.125, dpr: 3 });
    expect(ctx.log).toContain('setTransform(0.375,0,0,0.375,0,0)');
  });

  it('is deterministic: same frame + same viewport → identical journal', () => {
    const frame = sampleDoc().frames[0];
    expect(renderToLog(frame)).toEqual(renderToLog(frame));
  });

  it('matches the frozen Multator path-command journal at viewport scale 0.125 and DPR 2', () => {
    expect(renderToLog(sampleDoc().frames[0])).toEqual([
      'setTransform(1,0,0,1,0,0)', 'fillStyle=#ffffff', 'fillRect(0,0,1200,600)',
      'setTransform(0.25,0,0,0.25,0,0)', 'beginPath()', 'lineWidth=32',
      'strokeStyle=#000000', 'lineCap=round', 'lineJoin=round', 'moveTo(0,0)',
      'quadraticCurveTo(2400,1200,4800,2400)', 'stroke()',
      'beginPath()', 'fillStyle=#ff3300', `arc(100,100,80,0,${Math.PI * 2})`, 'fill()',
      'beginPath()', 'lineWidth=16', 'strokeStyle=#00aa55', 'lineCap=round',
      'lineJoin=round', 'moveTo(4800,0)', 'lineTo(0,2400)', 'stroke()',
    ]);
  });

  it('matches the frozen Multator pixel signature at viewport scale 0.125 and DPR 1', () => {
    const ctx = new RasterCtx();
    renderer.render(sampleDoc().frames[0], sampleTools, ctx, { scale: 0.125, dpr: 1 });
    expect(ctx.signature()).toBe('600x300:bf240169');
  });

  it('matches Tonio golden commands and representative DPR 1 pixels', () => {
    const frame: Frame = { strokes: [{ points: [80, 80, 320, 200, 320, 200], tool_id: 0 }] };
    const tools: ToolDescriptor[] = [
      { kind: 'pencil', dialect: 'toonio', width: 40, color: '#123456' },
    ];
    const recording = new RecordingCtx();
    renderer.render(frame, tools, recording, { scale: 0.125, dpr: 1 });
    expect(recording.log).toEqual([
      'setTransform(1,0,0,1,0,0)', 'fillStyle=#ffffff', 'fillRect(0,0,1200,600)',
      'setTransform(0.125,0,0,0.125,0,0)', 'beginPath()', 'lineWidth=40',
      'strokeStyle=#123456', 'lineCap=round', 'lineJoin=round',
      'quadraticCurveTo(80,80,200,140)',
      'quadraticCurveTo(320.01,200.01,320.005,200.005)', 'stroke()',
    ]);
    const raster = new RasterCtx();
    renderer.render(frame, tools, raster, { scale: 0.125, dpr: 1 });
    expect(raster.signature()).toBe('600x300:9845e529');
  });

  it('save→load→render is identical to the render before saving', () => {
    const doc = sampleDoc();
    const before = renderToLog(doc.frames[0]);
    const reloaded = JSON.parse(canonicalize(doc)) as ToonDocument;
    const after = renderToLog(reloaded.frames[0]);
    expect(after).toEqual(before);
  });
});

describe('renderStrokesLayer (composited layer)', () => {
  it('does not clear a background (transparent layer for stacking)', () => {
    const ctx = new RecordingCtx();
    renderStrokesLayer(sampleDoc().frames[0], sampleTools, ctx, viewport);
    // No full-canvas background fill — only the doc transform + strokes.
    expect(ctx.log).not.toContain('fillRect(0,0,1200,600)');
    expect(ctx.log[0]).toBe('setTransform(0.25,0,0,0.25,0,0)');
  });

  it('tint overrides every stroke color (onion-skin neighbor)', () => {
    const ctx = new RecordingCtx();
    renderStrokesLayer(sampleDoc().frames[0], sampleTools, ctx, viewport, '#ff3b30');
    const log = ctx.log.join('\n');
    expect(log).toContain('strokeStyle=#ff3b30');
    expect(log).toContain('fillStyle=#ff3b30'); // the dot too
    expect(log).not.toContain('#00aa55'); // original stroke colors gone
    expect(log).not.toContain('#000000');
  });

  it('eraser strokes (erase flag) erase via destination-out, then restore source-over', () => {
    const frame: Frame = {
      strokes: [
        { points: [0, 0, 100, 100, 200, 200], tool_id: 0 },
        { points: [0, 0, 50, 50, 100, 0], tool_id: 1 },
      ],
    };
    const ctx = new RecordingCtx();
    renderStrokesLayer(frame, [
      { kind: 'eraser', dialect: 'multator', width: 32 },
      { kind: 'pencil', dialect: 'multator', width: 16, color: '#000000' },
    ], ctx, viewport);
    const out = ctx.log.indexOf('globalCompositeOperation=destination-out');
    const back = ctx.log.indexOf('globalCompositeOperation=source-over');
    const pen = ctx.log.indexOf('strokeStyle=#000000');
    expect(out).toBeGreaterThan(-1);
    expect(back).toBeGreaterThan(out); // erase scoped to the eraser stroke
    expect(pen).toBeGreaterThan(back); // the pen stroke draws normally after
  });

  it('a white stroke without the erase flag paints (source-over), not erases', () => {
    const frame: Frame = {
      strokes: [{ points: [0, 0, 100, 100, 200, 200], tool_id: 0 }],
    };
    const ctx = new RecordingCtx();
    renderStrokesLayer(frame, [{ kind: 'pencil', dialect: 'multator', width: 32, color: '#ffffff' }], ctx, viewport);
    const log = ctx.log.join('\n');
    expect(log).not.toContain('globalCompositeOperation=destination-out');
    expect(log).toContain('strokeStyle=#ffffff');
  });

  it('tint does not repaint eraser strokes — they still erase', () => {
    const frame: Frame = {
      strokes: [{ points: [0, 0, 100, 100, 200, 200], tool_id: 0 }],
    };
    const ctx = new RecordingCtx();
    renderStrokesLayer(frame, [{ kind: 'eraser', dialect: 'multator', width: 32 }], ctx, viewport, '#ff3b30');
    const log = ctx.log.join('\n');
    expect(log).toContain('globalCompositeOperation=destination-out');
    expect(log).not.toContain('strokeStyle=#ff3b30');
  });
});

describe('contour tools (oldschool pen)', () => {
  const contourTools: ToolDescriptor[] = [
    { kind: 'contour', dialect: 'multator', color: '#ff0000' },
    { kind: 'contour-eraser', dialect: 'multator' },
  ];
  // A 4-point square contour: closed midpoint multicurve, filled.
  const square = [0, 0, 80, 0, 80, 80, 0, 80];

  it('fills a closed midpoint multicurve in the contour color (Frame.hx addSpline, size 0)', () => {
    const ctx = new RecordingCtx();
    renderer.render({ strokes: [{ points: square, tool_id: 0 }] }, contourTools, ctx, { scale: 1, dpr: 1 });
    const from = ctx.log.indexOf('beginPath()');
    expect(ctx.log.slice(from)).toEqual([
      'beginPath()',
      'fillStyle=#ff0000',
      'moveTo(40,0)',
      'quadraticCurveTo(80,0,80,40)',
      'quadraticCurveTo(80,80,40,80)',
      'quadraticCurveTo(0,80,0,40)',
      'quadraticCurveTo(0,0,40,0)',
      'fill()',
    ]);
  });

  it('the opaque renderer paints a contour eraser in the background color', () => {
    const ctx = new RecordingCtx();
    renderer.render({ strokes: [{ points: square, tool_id: 1 }] }, contourTools, ctx, { scale: 1, dpr: 1 });
    expect(ctx.log).toContain('fillStyle=#ffffff');
    expect(ctx.log.at(-1)).toBe('fill()');
  });

  it('the layer renderer erases a contour eraser via destination-out', () => {
    const ctx = new RecordingCtx();
    renderStrokesLayer({ strokes: [{ points: square, tool_id: 1 }] }, contourTools, ctx, { scale: 1, dpr: 1 });
    const on = ctx.log.indexOf('globalCompositeOperation=destination-out');
    const off = ctx.log.indexOf('globalCompositeOperation=source-over');
    const fill = ctx.log.indexOf('fill()');
    expect(on).toBeGreaterThanOrEqual(0);
    expect(fill).toBeGreaterThan(on);
    expect(off).toBeGreaterThan(fill);
  });
});

describe('renderRawPolyline (live preview)', () => {
  it('draws a raw polyline without smoothing', () => {
    const ctx = new RecordingCtx();
    renderRawPolyline([0, 0, 10.5, 20.25, 30, 40], 32, '#123456', ctx, viewport);
    const log = ctx.log.join('\n');
    expect(log).toContain('moveTo(0,0)');
    expect(log).toContain('lineTo(10.5,20.25)');
    expect(log).toContain('lineTo(30,40)');
    expect(log).not.toContain('quadraticCurveTo');
    expect(log).toContain('stroke()');
  });
});
