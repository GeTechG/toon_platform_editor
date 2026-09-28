import { describe, expect, it } from 'bun:test';
import { SQUARE_STAMP } from '../format/types';
import type { ToolDescriptor } from '../format/types';
import { eraseStrokes, strokesChanged } from '../tools/mega-eraser';
import { interpolatePixelLine } from '../tools/pixel';
import {
  addFrame,
  addStroke,
  createDocument,
  mirrorCell,
  removeLastStroke,
  transformStrokes,
} from '../model/operations';
import { FrameComposer, type ComposeBuffer, type ComposeTarget } from '../render/frame-compose';

// Thirteenth audit, tools: the mega eraser over a pixel row drawn backwards,
// over a cubic chain, over a dense frame and at the format's limits; the onion
// ghost of a cell rewritten in place; the tool key's shortcut for a reader.
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const toolKey = await Bun.file(new URL('./ToolKey.svelte', import.meta.url)).text();

function method(name: string): string {
  const match = state.match(new RegExp(`\\n  (?:get |private )?${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

const PIXEL_TOOLS: ToolDescriptor[] = [
  { kind: 'stamp', geometry: 'line', width: 10, color: '#000000', shape: [...SQUARE_STAMP] },
];
const cellsCut = (tool: ToolDescriptor) => (tool.kind === 'stamp' ? 'cells' as const : undefined);

/** Every cell the renderer stamps for a stored row — the same walk canvas2d makes. */
function stamped(points: readonly number[], width: number): string[] {
  const cells: string[] = [];
  for (let i = 0; i < points.length; i += 2) {
    if (i >= 2) {
      const between = interpolatePixelLine(points[i - 2], points[i - 1], points[i], points[i + 1], width);
      for (let j = 0; j < between.length; j += 2) cells.push(`${between[j]},${between[j + 1]}`);
    }
    cells.push(`${points[i]},${points[i + 1]}`);
  }
  return cells;
}

describe('the mega eraser cuts a pixel row whichever way it was drawn', () => {
  it('a row drawn right to left keeps the gap it was cut with', () => {
    // The walk between two stored cells comes back from the smaller end when
    // the row runs leftwards; the pieces kept that order, and the renderer's
    // own walk from 100 back to 0 filled the gap straight back in.
    const pieces = eraseStrokes([{ points: [100, 0, 0, 0], tool_id: 0 }], [55, 5], 6, PIXEL_TOOLS, cellsCut);
    expect(pieces.length).toBe(2);
    for (const piece of pieces) {
      expect(stamped(piece.points, 10)).not.toContain('50,0');
    }
  });

  it('a row drawn bottom to top does too', () => {
    const pieces = eraseStrokes([{ points: [0, 100, 0, 0], tool_id: 0 }], [5, 55], 6, PIXEL_TOOLS, cellsCut);
    expect(pieces.length).toBe(2);
    for (const piece of pieces) {
      expect(stamped(piece.points, 10)).not.toContain('0,50');
    }
  });
});

describe('the mega eraser keeps a cubic chain a cubic chain', () => {
  const CUBIC: ToolDescriptor[] = [{ kind: 'pencil', geometry: 'cubic', width: 40, color: '#000000' }];
  // Two arches: 0,0 up to 800,0 (its top at 400,-300), then down to 1600,0.
  // The control points stand well off the curve.
  const chain = [0, 0, 0, -400, 800, -400, 800, 0, 800, 400, 1600, 400, 1600, 0];

  it('the curve is cut where it runs, into a start point and whole segments of six', () => {
    // Cut as a polyline through its control points, the curve was missed at
    // its top, and the pieces kept arbitrary counts; the file check refuses a
    // cubic stroke that is not 2 + 6n, so the drawing stopped loading.
    const pieces = eraseStrokes([{ points: chain, tool_id: 0 }], [400, -300], 60, CUBIC);
    expect(pieces.length).toBe(2);
    for (const piece of pieces) {
      expect((piece.points.length - 2) % 6).toBe(0);
      expect(piece.points.every(Number.isInteger)).toBe(true);
    }
    expect(pieces[0].points.slice(0, 2)).toEqual([0, 0]);
    expect(pieces[1].points.slice(-2)).toEqual([1600, 0]);
    // The pieces stop at the capsule, not at the nearest anchor.
    const end = pieces[0].points.slice(-2);
    const start = pieces[1].points.slice(0, 2);
    expect(Math.abs(Math.hypot(end[0] - 400, end[1] + 300) - 60)).toBeLessThan(2);
    expect(Math.abs(Math.hypot(start[0] - 400, start[1] + 300) - 60)).toBeLessThan(2);
  });

  it('a sweep over a control point, far from the curve, takes nothing', () => {
    const before = [{ points: chain, tool_id: 0 }];
    expect(strokesChanged(before, eraseStrokes(before, [0, -300], 60, CUBIC))).toBe(false);
  });

  it('the pressure is cut along, one value per stored point', () => {
    const pressure = [10, 20, 30, 40, 50, 60, 70];
    const pieces = eraseStrokes([{ points: chain, tool_id: 0, pressure }], [400, -300], 60, CUBIC);
    expect(pieces.length).toBe(2);
    for (const piece of pieces) {
      expect(piece.pressure?.length).toBe(piece.points.length / 2);
    }
    expect(pieces[0].pressure![0]).toBe(10);
    expect(pieces[1].pressure!.at(-1)).toBe(70);
  });
});

describe('the mega eraser does not freeze a dense frame', () => {
  it('a long sweep over one corner of a full frame is cut in well under a second', () => {
    // Every sample of every stroke was tested against every segment of the
    // sweep: 300 strokes of 300 points under a 1500-point sweep took two
    // seconds on release, with the canvas frozen.
    let seed = 1;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const strokes = [];
    for (let s = 0; s < 300; s++) {
      const points: number[] = [];
      let x = random() * 10000;
      let y = random() * 5700;
      for (let i = 0; i < 300; i++) {
        x += (random() - 0.5) * 80;
        y += (random() - 0.5) * 80;
        points.push(Math.round(x), Math.round(y));
      }
      strokes.push({ points, tool_id: 0 });
    }
    const sweep: number[] = [];
    for (let i = 0; i < 1500; i++) sweep.push(1000 + Math.round(Math.sin(i / 30) * 800), 1000 + i);
    const started = performance.now();
    const after = eraseStrokes(strokes, sweep, 40);
    expect(performance.now() - started).toBeLessThan(500);
    expect(strokesChanged(strokes, after)).toBe(true);
  });

  it('what the sweep never came near comes back as it was', () => {
    const far = { points: [9000, 5000, 9100, 5100], tool_id: 0, pressure: [30, 60] };
    const [after] = eraseStrokes([far], [0, 0, 100, 100], 20);
    expect(after).toEqual(far);
  });
});

describe('an erase or a redo the format refuses leaves nothing half done', () => {
  it('the mega eraser catches the limit instead of throwing out of the release', () => {
    // A cut that pushed the frame past the point or stroke limit threw from
    // pointerup: the sweep was never cleared and kept following the hover.
    expect(method('applyMegaEraser')).toMatch(/try \{[^]*replaceStrokes[^]*\} catch/);
  });

  it('redo keeps the stroke on its stack when the frame cannot take it back', () => {
    const redo = method('redo');
    expect(redo).toMatch(/try \{[^]*addStroke[^]*\} catch/);
    expect(redo.indexOf('this.undone = this.undone.slice(0, -1)'))
      .toBeGreaterThan(redo.indexOf('addStroke'));
  });
});

/** A buffer that notes what was drawn on it, the way the composer test does. */
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
  stroke(): void { this.log.push('stroke'); }
  fill(): void { this.log.push('fill'); }
  drawImage(image: CanvasImageSource): void {
    const from = (image as unknown as { recorder?: Recorder }).recorder;
    this.log.push(`blit ${from?.name ?? '?'}${this.globalAlpha < 1 ? ` @${this.globalAlpha}` : ''}`);
  }
}

describe('the onion ghost of a cell follows an edit that keeps its stroke count', () => {
  const line = (x: number) => ({ points: [x, 0, x, 400, x + 10, 800], width: 40, color: '#000000' });
  const viewport = { scale: 0.1, dpr: 1, panX: 0, panY: 0 };

  function ghostRedrawn(edit: (doc: ReturnType<typeof createDocument>) => void): boolean {
    const doc = createDocument();
    addStroke(doc, 0, 0, line(100));
    addStroke(doc, 0, 0, line(300));
    addFrame(doc, 0);
    const made: Recorder[] = [];
    const composer = new FrameComposer(() => {
      const buffer = new Recorder(`b${made.length}`);
      made.push(buffer);
      return buffer;
    });
    const target = new Recorder('target');
    const scene = () => ({
      doc, frame: 1, activeLayer: 0, viewport, tools: doc.tools,
      ghosts: { frames: [{ index: 0, alpha: 0.3 }], layers: [0] },
    });
    composer.compose(target.ctx, 100, 50, scene());
    const name = target.log.find((entry) => entry.includes('@0.3'))!.split(' ')[1];
    const ghost = made.find((buffer) => buffer.name === name)!;
    const drawn = ghost.log.length;
    edit(doc);
    composer.invalidate();
    target.log.length = 0;
    composer.compose(target.ctx, 100, 50, scene());
    // Redrawn either into the same buffer or into a fresh one of the ring.
    const again = target.log.find((entry) => entry.includes('@0.3'))!.split(' ')[1];
    return again !== name || ghost.log.length > drawn;
  }

  it('an undone stroke drawn over with another is a new ghost', () => {
    // The ghost was keyed by the cell and its count: undo one line, draw
    // another, and the next frame's onion still showed the undone one.
    expect(ghostRedrawn((doc) => {
      removeLastStroke(doc, 0, 0);
      addStroke(doc, 0, 0, line(700));
    })).toBe(true);
  });

  it('a mirrored cell is a new ghost', () => {
    expect(ghostRedrawn((doc) => mirrorCell(doc, 0, 0, 'horizontal'))).toBe(true);
  });

  it('a transformed cell is a new ghost', () => {
    expect(ghostRedrawn((doc) => transformStrokes(doc, 0, 0, null, [1, 0, 0, 1, 50, 0]))).toBe(true);
  });

  it('a ghost nobody touched is not drawn again', () => {
    expect(ghostRedrawn(() => {})).toBe(false);
  });
});

describe('a tool key tells a reader its shortcut', () => {
  it('the key carries aria-keyshortcuts, and only while the letter keys work', () => {
    // The shortcut was only in the tooltip, which a screen reader does not
    // read for a key that already has a name.
    expect(toolKey).toContain('aria-keyshortcuts={editor.keyHint(spec.key) || undefined}');
  });
});
