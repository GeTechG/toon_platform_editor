import { describe, expect, it } from 'bun:test';
import { canonicalize } from '../format/canonical';
import type { Frame, ToonDocument } from '../format/types';
import { Canvas2DFrameRenderer, renderRawPolyline, type Canvas2DLike } from './canvas2d';

/** Recording context: journals every command and property assignment. */
class RecordingCtx implements Canvas2DLike {
  log: string[] = [];
  canvas = { width: 1200, height: 600 };
  #props: Record<string, unknown> = {};

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

const renderer = new Canvas2DFrameRenderer();
const viewport = { scale: 0.125, dpr: 2 };

function sampleDoc(): ToonDocument {
  return {
    schema_version: 1,
    width: 4800,
    height: 2400,
    frame_rate: 12,
    frames: [
      {
        strokes: [
          { points: [0, 0, 2400, 1200, 4800, 2400], width: 32, color: '#000000' },
          { points: [100, 100], width: 160, color: '#ff3300' },
          { points: [4800, 0, 0, 2400], width: 16, color: '#00aa55' },
        ],
      },
    ],
  };
}

function renderToLog(frame: Frame): string[] {
  const ctx = new RecordingCtx();
  renderer.render(frame, ctx, viewport);
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
    renderer.render({ strokes: [] }, ctx, { scale: 0.125, dpr: 3 });
    expect(ctx.log).toContain('setTransform(0.375,0,0,0.375,0,0)');
  });

  it('is deterministic: same frame + same viewport → identical journal', () => {
    const frame = sampleDoc().frames[0];
    expect(renderToLog(frame)).toEqual(renderToLog(frame));
  });

  it('save→load→render is identical to the render before saving', () => {
    const doc = sampleDoc();
    const before = renderToLog(doc.frames[0]);
    const reloaded = JSON.parse(canonicalize(doc)) as ToonDocument;
    const after = renderToLog(reloaded.frames[0]);
    expect(after).toEqual(before);
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
