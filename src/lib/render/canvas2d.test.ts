import { describe, expect, it } from 'bun:test';
import { canonicalize } from '../format/canonical';
import { loadDocument } from '../format/validate';
import { SQUARE_STAMP } from '../format/types';
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
  clearRect(...args: number[]): void {
    this.log.push(`clearRect(${args.join(',')})`);
  }
  drawImage(image: unknown, dx: number, dy: number): void {
    this.log.push(`drawImage(${(image as { id?: string }).id ?? 'image'},${dx},${dy})`);
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
  clearRect(x: number, y: number, width: number, height: number): void {
    this.#fillArea(x, y, width, height, 0);
  }
  drawImage(image: unknown, _dx: number, _dy: number): void {
    const source = (image as { pixels: Uint32Array }).pixels;
    for (let i = 0; i < this.pixels.length; i++) {
      // source-over for the only two alphas this rasterizer produces (0 / 255).
      if (source[i] >>> 24) {
        this.pixels[i] = source[i];
      }
    }
  }
  #fillArea(x: number, y: number, width: number, height: number, color: number): void {
    for (let py = Math.max(0, y); py < Math.min(this.canvas.height, y + height); py++) {
      this.pixels.fill(color, py * this.canvas.width + Math.max(0, x), py * this.canvas.width + Math.min(this.canvas.width, x + width));
    }
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
      this.#drawSegment(this.#path[i - 1], this.#path[i], radius, this.#paint(this.strokeStyle));
    }
  }
  fill(): void {
    if (this.#arc) this.#drawDisc(...this.#arc, this.#paint(this.fillStyle));
    else if (this.#path.length > 2) {
      for (let i = 1; i < this.#path.length; i++) {
        this.#drawSegment(this.#path[i - 1], this.#path[i], 1, this.#paint(this.fillStyle));
      }
    }
  }
  /** destination-out clears alpha instead of painting a color. */
  #paint(color: string): number {
    return this.globalCompositeOperation === 'destination-out' ? 0 : rgba(color);
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

function docOf(tools: ToolDescriptor[], ...layers: Frame[][]): ToonDocument {
  return {
    schema_version: 6,
    width: 4800,
    height: 2400,
    frame_rate: 12,
    tools,
    layers: layers.map((frames) => ({ hidden: false, frames })),
  };
}

function sampleDoc(): ToonDocument {
  return docOf(sampleTools, [
    {
      strokes: [
        { points: [0, 0, 2400, 1200, 4800, 2400], tool_id: 0 },
        { points: [100, 100], tool_id: 1 },
        { points: [4800, 0, 0, 2400], tool_id: 2 },
      ],
    },
  ]);
}

/** Recording renderer whose scratch layers are recording contexts too. */
function recordingRenderer(scratchLog?: string[]): Canvas2DFrameRenderer {
  return new Canvas2DFrameRenderer(() => {
    const ctx = new RecordingCtx();
    if (scratchLog) ctx.log = scratchLog;
    return { ctx, image: { id: 'scratch' } as unknown as CanvasImageSource };
  });
}

/** Rasterizing renderer: the scratch is a RasterCtx, blitted by drawImage. */
function rasterRenderer(): Canvas2DFrameRenderer {
  return new Canvas2DFrameRenderer(() => {
    const ctx = new RasterCtx();
    return { ctx, image: ctx as unknown as CanvasImageSource };
  });
}

function rasterSignature(doc: ToonDocument, frameIndex = 0): string {
  const ctx = new RasterCtx();
  rasterRenderer().render(doc, frameIndex, ctx, { scale: 0.125, dpr: 1 });
  return ctx.signature();
}

function renderToLog(doc: ToonDocument, frameIndex = 0): string[] {
  const ctx = new RecordingCtx();
  renderer.render(doc, frameIndex, ctx, viewport);
  return ctx.log;
}

describe('Canvas2DFrameRenderer', () => {
  it('empty frame: clears the background, no strokes, no errors', () => {
    const log = renderToLog(docOf(sampleTools, [{ strokes: [] }]));
    expect(log).toEqual([
      'setTransform(1,0,0,1,0,0)',
      'fillStyle=#ffffff',
      'fillRect(0,0,1200,600)',
      'setTransform(0.25,0,0,0.25,0,0)',
    ]);
  });

  it('viewport.background: null clears instead of filling (transparent PNG)', () => {
    const ctx = new RecordingCtx();
    renderer.render(docOf(sampleTools, [{ strokes: [] }]), 0, ctx, { ...viewport, background: null });
    expect(ctx.log).toEqual([
      'setTransform(1,0,0,1,0,0)',
      'clearRect(0,0,1200,600)',
      'setTransform(0.25,0,0,0.25,0,0)',
    ]);
  });

  it('viewport.background paints the color it is given', () => {
    const ctx = new RecordingCtx();
    renderer.render(docOf(sampleTools, [{ strokes: [] }]), 0, ctx, { ...viewport, background: '#112233' });
    expect(ctx.log).toContain('fillStyle=#112233');
  });

  it('draws strokes in order with their attributes', () => {
    const log = renderToLog(sampleDoc()).join('\n');
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
    renderer.render(docOf(sampleTools, [{ strokes: [] }]), 0, ctx, { scale: 0.125, dpr: 3 });
    expect(ctx.log).toContain('setTransform(0.375,0,0,0.375,0,0)');
  });

  it('is deterministic: same frame + same viewport → identical journal', () => {
    const doc = sampleDoc();
    expect(renderToLog(doc)).toEqual(renderToLog(doc));
  });

  it('matches the frozen Multator path-command journal at viewport scale 0.125 and DPR 2', () => {
    expect(renderToLog(sampleDoc())).toEqual([
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
    renderer.render(sampleDoc(), 0, ctx, { scale: 0.125, dpr: 1 });
    expect(ctx.signature()).toBe('600x300:bf240169');
  });

  it('matches Tonio golden commands and representative DPR 1 pixels', () => {
    const frame: Frame = { strokes: [{ points: [80, 80, 320, 200, 320, 200], tool_id: 0 }] };
    const tools: ToolDescriptor[] = [
      { kind: 'pencil', dialect: 'toonio', width: 40, color: '#123456' },
    ];
    const recording = new RecordingCtx();
    renderer.render(docOf(tools, [frame]), 0, recording, { scale: 0.125, dpr: 1 });
    expect(recording.log).toEqual([
      'setTransform(1,0,0,1,0,0)', 'fillStyle=#ffffff', 'fillRect(0,0,1200,600)',
      'setTransform(0.125,0,0,0.125,0,0)', 'beginPath()', 'lineWidth=40',
      'strokeStyle=#123456', 'lineCap=round', 'lineJoin=round',
      'quadraticCurveTo(80,80,200,140)',
      'quadraticCurveTo(320.01,200.01,320.005,200.005)', 'stroke()',
    ]);
    const raster = new RasterCtx();
    renderer.render(docOf(tools, [frame]), 0, raster, { scale: 0.125, dpr: 1 });
    expect(raster.signature()).toBe('600x300:9845e529');
  });

  it('save→load→render is identical to the render before saving', () => {
    const doc = sampleDoc();
    const before = renderToLog(doc);
    const reloaded = JSON.parse(canonicalize(doc)) as ToonDocument;
    const after = renderToLog(reloaded);
    expect(after).toEqual(before);
  });
});

describe('layer composition', () => {
  const black: ToolDescriptor = { kind: 'pencil', dialect: 'multator', width: 32, color: '#000000' };
  const red: ToolDescriptor = { kind: 'pencil', dialect: 'multator', width: 400, color: '#ff0000' };
  const eraser: ToolDescriptor = { kind: 'eraser', dialect: 'multator', width: 400 };
  const contourEraser: ToolDescriptor = { kind: 'contour-eraser', dialect: 'multator' };
  const tools = [black, red, eraser, contourEraser];
  const wide = [0, 1200, 4800, 1200];

  function twoLayers(upper: Frame): ToonDocument {
    return docOf(tools, [{ strokes: [{ points: wide, tool_id: 1 }] }], [upper]);
  }

  it('draws the background once and blits every visible layer bottom-up', () => {
    const ctx = new RecordingCtx();
    const scratch: string[] = [];
    recordingRenderer(scratch).render(twoLayers({ strokes: [{ points: wide, tool_id: 0 }] }), 0, ctx, viewport);
    expect(ctx.log.slice(0, 3)).toEqual([
      'setTransform(1,0,0,1,0,0)', 'fillStyle=#ffffff', 'fillRect(0,0,1200,600)',
    ]);
    expect(ctx.log.filter((line) => line.startsWith('drawImage'))).toEqual([
      'drawImage(scratch,0,0)', 'drawImage(scratch,0,0)',
    ]);
    // The scratch is cleared before each layer and never painted with a background.
    expect(scratch.filter((line) => line.startsWith('clearRect'))).toHaveLength(2);
    expect(scratch).not.toContain('fillRect(0,0,1200,600)');
    // Layers are rasterized bottom-up: the red fill before the black line.
    expect(scratch.indexOf('strokeStyle=#ff0000')).toBeLessThan(scratch.indexOf('strokeStyle=#000000'));
  });

  it('an eraser on the upper layer does not cut the layer below', () => {
    const erased = rasterSignature(twoLayers({ strokes: [{ points: wide, tool_id: 2 }] }));
    const lowerOnly = rasterSignature(docOf(tools, [{ strokes: [{ points: wide, tool_id: 1 }] }]));
    expect(erased).toBe(lowerOnly);
  });

  it('a contour-eraser on the upper layer does not cut the layer below', () => {
    const contour = { points: [0, 1000, 4800, 1000, 4800, 1400, 0, 1400], tool_id: 3 };
    const erased = rasterSignature(twoLayers({ strokes: [contour] }));
    const lowerOnly = rasterSignature(docOf(tools, [{ strokes: [{ points: wide, tool_id: 1 }] }]));
    expect(erased).toBe(lowerOnly);
  });

  it('a hidden layer renders exactly like a document without it', () => {
    const doc = twoLayers({ strokes: [{ points: wide, tool_id: 0 }] });
    doc.layers[1].hidden = true;
    expect(rasterSignature(doc)).toBe(
      rasterSignature(docOf(tools, [{ strokes: [{ points: wide, tool_id: 1 }] }])),
    );
  });

  it('renders the requested frame index across layers', () => {
    const doc = docOf(
      tools,
      [{ strokes: [] }, { strokes: [{ points: wide, tool_id: 1 }] }],
      [{ strokes: [] }, { strokes: [] }],
    );
    expect(rasterSignature(doc, 1)).not.toBe(rasterSignature(doc, 0));
  });
});

describe('single-layer fast path', () => {
  it('draws straight into the target, without a scratch layer', () => {
    const ctx = new RecordingCtx();
    const scratch: string[] = [];
    recordingRenderer(scratch).render(sampleDoc(), 0, ctx, viewport);
    expect(scratch).toEqual([]);
    expect(ctx.log.some((line) => line.startsWith('drawImage'))).toBe(false);
  });

  it('is pixel-identical to the composited path', () => {
    const doc = sampleDoc();
    const fast = new RasterCtx();
    rasterRenderer().render(doc, 0, fast, { scale: 0.125, dpr: 1 });

    // Same content, forced through the composite path by a second, empty layer.
    const composited = structuredClone(doc);
    composited.layers.push({ hidden: false, frames: [{ strokes: [] }] });
    const slow = new RasterCtx();
    rasterRenderer().render(composited, 0, slow, { scale: 0.125, dpr: 1 });

    expect(fast.signature()).toBe(slow.signature());
  });

  it('a frame with erasers takes the composited path', () => {
    const tools: ToolDescriptor[] = [
      { kind: 'pencil', dialect: 'multator', width: 32, color: '#000000' },
      { kind: 'eraser', dialect: 'multator', width: 400 },
    ];
    const ctx = new RecordingCtx();
    const scratch: string[] = [];
    recordingRenderer(scratch).render(
      docOf(tools, [{ strokes: [{ points: [0, 0, 4800, 2400], tool_id: 0 }, { points: [0, 1200, 4800, 1200], tool_id: 1 }] }]),
      0, ctx, viewport,
    );
    expect(scratch.length).toBeGreaterThan(0);
    expect(ctx.log).toContain('drawImage(scratch,0,0)');
  });

  it('a migrated v2 document renders exactly as it did before migration', () => {
    const v2 = {
      schema_version: 2, width: 4800, height: 2400, frame_rate: 12,
      tools: sampleTools,
      frames: sampleDoc().layers[0].frames,
    };
    const migrated = loadDocument(v2);
    expect(renderToLog(migrated)).toEqual(renderToLog(sampleDoc()));
    expect(rasterSignature(migrated)).toBe(rasterSignature(sampleDoc()));
  });
});

describe('renderStrokesLayer (composited layer)', () => {
  it('does not clear a background (transparent layer for stacking)', () => {
    const ctx = new RecordingCtx();
    renderStrokesLayer(sampleDoc().layers[0].frames[0], sampleTools, ctx, viewport);
    // No full-canvas background fill — only the doc transform + strokes.
    expect(ctx.log).not.toContain('fillRect(0,0,1200,600)');
    expect(ctx.log[0]).toBe('setTransform(0.25,0,0,0.25,0,0)');
  });

  it('tint overrides every stroke color (onion-skin neighbor)', () => {
    const ctx = new RecordingCtx();
    renderStrokesLayer(sampleDoc().layers[0].frames[0], sampleTools, ctx, viewport, '#ff3b30');
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
      { kind: 'pencil', dialect: 'multator', width: 16, color: '#00aa55' },
    ], ctx, viewport);
    const out = ctx.log.indexOf('globalCompositeOperation=destination-out');
    const back = ctx.log.indexOf('globalCompositeOperation=source-over');
    const pen = ctx.log.indexOf('strokeStyle=#00aa55');
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
    renderer.render(docOf(contourTools, [{ strokes: [{ points: square, tool_id: 0 }] }]), 0, ctx, { scale: 1, dpr: 1 });
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

  it('a contour eraser erases alpha in every consumer — never paints the background', () => {
    const ctx = new RecordingCtx();
    const scratch: string[] = [];
    recordingRenderer(scratch).render(
      docOf(contourTools, [{ strokes: [{ points: square, tool_id: 1 }] }]),
      0, ctx, { scale: 1, dpr: 1 },
    );
    expect(scratch).toContain('globalCompositeOperation=destination-out');
    // The background is painted once on the target, never as an eraser stroke.
    expect(scratch).not.toContain('fillStyle=#ffffff');
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

describe('Tonio feather and pixel tools', () => {
  const tools: ToolDescriptor[] = [
    { kind: 'feather', dialect: 'toonio', width: 32, color: '#000000', fill: '#ff0000' },
    { kind: 'stamp', dialect: 'toonio', width: 16, color: '#0026ff', shape: SQUARE_STAMP },
  ];

  it('the feather fills the path before stroking it (tools.js Feather.PostDraw)', () => {
    const ctx = new RecordingCtx();
    // Tonio committed lines carry the duplicated endpoint sentinel.
    const line = [0, 0, 40, 0, 40, 40, 40, 40];
    renderer.render(docOf(tools, [{ strokes: [{ points: line, tool_id: 0 }] }]), 0, ctx, { scale: 1, dpr: 1 });
    const from = ctx.log.indexOf('beginPath()');
    expect(ctx.log.slice(from)).toEqual([
      'beginPath()',
      'fillStyle=#ff0000',
      'lineWidth=32',
      'strokeStyle=#000000',
      'lineCap=round',
      'lineJoin=round',
      'quadraticCurveTo(0,0,20,0)',
      'quadraticCurveTo(40,0,40,20)',
      // Duplicated endpoint sentinel → the reference's +0.01 Chrome workaround.
      'quadraticCurveTo(40.01,40.01,40.004999999999995,40.004999999999995)',
      'fill()',
      'stroke()',
    ]);
  });

  it('fills the cells a fast drag skipped (reference Draw → InterpolateLine)', () => {
    const ctx = new RecordingCtx();
    renderer.render(
      docOf(tools, [{ strokes: [{ points: [0, 0, 48, 0], tool_id: 1 }] }]),
      0, ctx, { scale: 1, dpr: 1 },
    );
    // Both endpoints come back from the interpolation and are painted again —
    // the reference repaints them too, and a cell filled twice looks the same.
    expect(ctx.log.filter((line) => line.startsWith('fillRect')).slice(1)).toEqual([
      'fillRect(0,0,16,16)',
      'fillRect(0,0,16,16)',
      'fillRect(16,0,16,16)',
      'fillRect(32,0,16,16)',
      'fillRect(48,0,16,16)',
      'fillRect(48,0,16,16)',
    ]);
  });

  it('the pixel tool fills a square per cell, no smoothing (tools.js Pixel.Draw)', () => {
    const ctx = new RecordingCtx();
    renderer.render(
      docOf(tools, [{ strokes: [{ points: [0, 0, 16, 0, 16, 16], tool_id: 1 }] }]),
      0, ctx, { scale: 1, dpr: 1 },
    );
    const from = ctx.log.indexOf('fillStyle=#0026ff');
    expect(ctx.log.slice(from)).toEqual([
      'fillStyle=#0026ff',
      'fillRect(0,0,16,16)',
      'fillRect(0,0,16,16)',
      'fillRect(16,0,16,16)',
      'fillRect(16,0,16,16)',
      'fillRect(16,0,16,16)',
      'fillRect(16,16,16,16)',
      'fillRect(16,16,16,16)',
    ]);
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

  it('fills the path first when the tool is a filled one (the feather)', () => {
    // The live Multator gesture is the raw polyline, but a feather fills what
    // it encloses — without this the fill only appeared on release.
    const ctx = new RecordingCtx();
    renderRawPolyline([0, 0, 10, 20, 30, 40], 32, '#123456', ctx, viewport, '#ff0000');
    const log = ctx.log.join('\n');
    expect(log).toContain('fillStyle=#ff0000');
    expect(log.indexOf('fill()')).toBeLessThan(log.indexOf('stroke()'));
  });
});
