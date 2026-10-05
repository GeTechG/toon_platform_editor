import { describe, expect, it } from 'bun:test';
import { addLayer, addStroke, createDocument } from '../model/operations';
import { FrameComposer, type ComposeBuffer, type ComposeTarget } from '../render/frame-compose';
import { emitPressuredOutline, flattenPressured, pressureWidth } from '../render/pressure';
import { emitGeometry, type StrokeGeometry } from '../render/smoothing';

const source = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
const pressureSource = await Bun.file(new URL('../render/pressure.ts', import.meta.url)).text();

/** A buffer that writes down what lands on it (frame-compose.test.ts). */
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
  size(width: number, height: number): void { this.canvas.width = width; this.canvas.height = height; }
  clear(): void {}
  setTransform(): void {}
  fillRect(): void {}
  clearRect(): void {}
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  quadraticCurveTo(): void {}
  bezierCurveTo(): void {}
  arc(): void {}
  stroke(): void {}
  fill(): void {}
  drawImage(image: CanvasImageSource): void {
    const from = (image as unknown as { recorder?: Recorder }).recorder;
    this.log.push(`blit ${from?.name ?? '?'}`);
  }
}

function composer() {
  let made = 0;
  return new FrameComposer(() => new Recorder(`b${made++}`));
}

const viewport = { scale: 0.1, dpr: 1, panX: 0, panY: 0 };
const line = (x: number) => ({ points: [x, 0, x, 400, x + 10, 800], width: 40, color: '#000000' });

describe('a frame with nothing below or above the active layer', () => {
  it('blits only the active layer: two empty stage-sized buffers cost a weak phone every frame of a stroke', () => {
    const doc = createDocument();
    addStroke(doc, 0, 0, line(100));
    const target = new Recorder('target');
    composer().compose(target.ctx, 100, 50, { doc, frame: 0, activeLayer: 0, viewport, tools: doc.tools });
    // b0 below, b1 active, b2 above.
    expect(target.log).toEqual(['blit b1']);
  });

  it('a layer whose cell is empty or hidden is nothing to blit either', () => {
    const doc = createDocument();
    addLayer(doc, 1);
    addLayer(doc, 2);
    addStroke(doc, 1, 0, line(100));
    doc.layers[2].hidden = true;
    addStroke(doc, 2, 0, line(200));
    const target = new Recorder('target');
    composer().compose(target.ctx, 100, 50, { doc, frame: 0, activeLayer: 1, viewport, tools: doc.tools });
    expect(target.log).toEqual(['blit b1']);
  });

  it('still blits a layer above once it has a line', () => {
    const doc = createDocument();
    addLayer(doc, 1);
    addStroke(doc, 1, 0, line(100));
    const target = new Recorder('target');
    const compose = composer();
    compose.compose(target.ctx, 100, 50, { doc, frame: 0, activeLayer: 0, viewport, tools: doc.tools });
    expect(target.log).toEqual(['blit b1', 'blit b2']);
    // The pipette still reads all three.
    expect(compose.layers).not.toBeNull();
  });
});

/** The flattening as it was, closure per command: the oracle for the lean one. */
function flattenReference(points: readonly number[], pressure: readonly number[], geometry: StrokeGeometry): number[] {
  const commands: ((t: number) => [number, number])[] = [];
  let start: [number, number] = [points[0], points[1]];
  let px = points[0];
  let py = points[1];
  emitGeometry(points, geometry, false, {
    moveTo(x, y) { start = [x, y]; px = x; py = y; },
    lineTo(x, y) {
      const [ax, ay] = [px, py];
      commands.push((t) => [ax + (x - ax) * t, ay + (y - ay) * t]);
      px = x; py = y;
    },
    quadraticCurveTo(cx, cy, x, y) {
      const [ax, ay] = [px, py];
      commands.push((t) => {
        const u = 1 - t;
        return [u * u * ax + 2 * u * t * cx + t * t * x, u * u * ay + 2 * u * t * cy + t * t * y];
      });
      px = x; py = y;
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      const [ax, ay] = [px, py];
      commands.push((t) => {
        const u = 1 - t;
        const a = u * u * u; const b = 3 * u * u * t; const c = 3 * u * t * t; const d = t * t * t;
        return [a * ax + b * c1x + c * c2x + d * x, a * ay + b * c1y + c * c2y + d * y];
      });
      px = x; py = y;
    },
  });
  const last = pressure.length - 1;
  const at = (s: number): number => {
    const i = Math.min(last, Math.max(0, Math.floor(s)));
    const next = Math.min(last, i + 1);
    return pressure[i] + (pressure[next] - pressure[i]) * (s - i);
  };
  const out = [start[0], start[1], pressure[0]];
  const count = commands.length;
  commands.forEach((command, k) => {
    const steps = geometry === 'line' ? 1 : 8;
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const [x, y] = command(t);
      out.push(x, y, at(((k + t) / count) * last));
    }
  });
  return out;
}

function outlineReference(flat: readonly number[], width: number): string[] {
  const log: string[] = [];
  const radius = (i: number): number => pressureWidth(width, flat[i + 2]) / 2;
  for (let i = 0; i < flat.length; i += 3) {
    const r = radius(i);
    log.push(`m ${flat[i] + r} ${flat[i + 1]}`, `a ${flat[i]} ${flat[i + 1]} ${r}`);
  }
  for (let i = 3; i < flat.length; i += 3) {
    const [ax, ay, bx, by] = [flat[i - 3], flat[i - 2], flat[i], flat[i + 1]];
    const length = Math.hypot(bx - ax, by - ay);
    if (length === 0) continue;
    const nx = -(by - ay) / length;
    const ny = (bx - ax) / length;
    const ra = radius(i - 3);
    const rb = radius(i);
    const quad = [ax + nx * ra, ay + ny * ra, bx + nx * rb, by + ny * rb, bx - nx * rb, by - ny * rb, ax - nx * ra, ay - ny * ra];
    let area = 0;
    for (let j = 0; j < 8; j += 2) {
      const k = (j + 2) % 8;
      area += quad[j] * quad[k + 1] - quad[k] * quad[j + 1];
    }
    const order = area > 0 ? [0, 2, 4, 6] : [6, 4, 2, 0];
    log.push(`m ${quad[order[0]]} ${quad[order[0] + 1]}`);
    for (let j = 1; j < 4; j++) log.push(`l ${quad[order[j]]} ${quad[order[j] + 1]}`);
  }
  return log;
}

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe('the pen line under the hand, redrawn whole every frame', () => {
  it('flattens with no closure per command and no tuple per sample', () => {
    const flatten = pressureSource.slice(pressureSource.indexOf('export function flattenPressured'),
      pressureSource.indexOf('export interface OutlineSink'));
    expect(flatten).not.toContain('commands.push((t)');
    expect(flatten).not.toContain('const [x, y] = command(t)');
    const outline = pressureSource.slice(pressureSource.indexOf('export function emitPressuredOutline'),
      pressureSource.indexOf('function cumulative'));
    expect(outline).not.toContain('const quad = [');
    expect(outline).not.toContain('const order = ');
  });

  for (const geometry of ['line', 'smooth', 'cubic'] as const) {
    it(`draws exactly what it drew before (${geometry})`, () => {
      const random = seeded(geometry.length * 7919);
      for (let run = 0; run < 20; run++) {
        const n = geometry === 'cubic' ? 1 + 3 * (1 + Math.floor(random() * 6)) : 1 + Math.floor(random() * 30);
        const points: number[] = [];
        const pressure: number[] = [];
        for (let i = 0; i < n; i++) {
          points.push(Math.round(random() * 4000), Math.round(random() * 3000));
          pressure.push(Math.round(random() * 100));
        }
        if (run === 0 && n > 1) { points[2] = points[0]; points[3] = points[1]; }
        const flat = flattenPressured(points, pressure, geometry);
        expect(flat).toEqual(flattenReference(points, pressure, geometry));
        const log: string[] = [];
        emitPressuredOutline(flat, 90, {
          moveTo: (x, y) => log.push(`m ${x} ${y}`),
          lineTo: (x, y) => log.push(`l ${x} ${y}`),
          arc: (x, y, r) => log.push(`a ${x} ${y} ${r}`),
        });
        expect(log).toEqual(outlineReference(flat, 90));
      }
    });
  }
});

describe("Safari's trackpad pinch", () => {
  it('comes as gesture events, not Ctrl+wheel: the canvas takes them, or the whole page zooms', () => {
    expect(source).toContain("addEventListener('gesturestart'");
    expect(source).toContain("addEventListener('gesturechange'");
    expect(source).toContain("addEventListener('gestureend'");
    const change = source.slice(source.indexOf('function onGestureChange'));
    expect(change.slice(0, 900)).toContain('e.preventDefault()');
  });

  it('leaves a pinch on glass to the fingers: iOS sends gesture events alongside the touches', () => {
    const change = source.slice(source.indexOf('function onGestureChange'));
    expect(change.slice(0, 900)).toContain('touches.size > 0');
  });
});

describe('thirteenth audit: canvas timers die with the canvas', () => {
  it('clears the hold and hint timers when the canvas unmounts', () => {
    const destroy = source.match(/onDestroy\(\(\) => \{[^]*?\n  \}\);/);
    expect(destroy).not.toBeNull();
    expect(destroy![0]).toContain('cancelHold()');
    expect(destroy![0]).toContain('clearTimeout(hintTimer)');
  });
});
