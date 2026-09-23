import { describe, expect, it } from 'bun:test';
import { SQUARE_STAMP } from '../format/types';
import { STROKE_COORD_MAX, STROKE_COORD_MIN, MAX_STROKE_COORDS } from '../format/constants';
import { eraseStrokes, strokesChanged } from '../tools/mega-eraser';
import { toonopRules } from '../tools/brush';
import { PointerStrokeController } from '../tools/profiles';
import { scaledBy, EMPTY_TRANSFORM } from '../tools/lasso';

// Twelfth audit, tools: the mega eraser's no-op check, redo and pressure,
// strokes that leave the int16 range, the transform's history.
// The store is runes state, so it is asserted as source, like audit11.
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const canvas = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
const menu = await Bun.file(new URL('./TransformMenu.svelte', import.meta.url)).text();

function method(name: string): string {
  const match = state.match(new RegExp(`\\n  (?:get |private )?${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

const line = (points: number[], tool_id = 0) => ({ points, tool_id });

describe('the mega eraser tells a trim from a miss', () => {
  it('a trimmed end keeps the point count and still counts as an erase', () => {
    // [0,0 → 800,0] with the end rubbed off becomes [0,0 → 780,0]: the same
    // number of points, and the editor read that as "nothing happened".
    const before = [line([0, 0, 800, 0])];
    const after = eraseStrokes(before, [800, 0], 20);
    expect(after[0].points.length).toBe(before[0].points.length);
    expect(strokesChanged(before, after)).toBe(true);
  });

  it('a gesture over empty space changes nothing', () => {
    const before = [line([0, 0, 800, 0])];
    expect(strokesChanged(before, eraseStrokes(before, [0, 500], 20))).toBe(false);
  });

  it('a row of cells the capsule missed comes back as it was stored', () => {
    // It came back with every in-between cell written out, so a miss over a
    // pixel line rewrote it and filed an undo step with nothing to show.
    const pixelTools = [{ kind: 'stamp', geometry: 'line', width: 10, color: '#000000', shape: SQUARE_STAMP }] as const;
    const cutOf = (tool: { kind: string }) => (tool.kind === 'stamp' ? 'cells' as const : undefined);
    const before = [line([0, 0, 100, 0])];
    const after = eraseStrokes(before, [0, 500], 6, pixelTools, cutOf);
    expect(after).toEqual(before);
    expect(strokesChanged(before, after)).toBe(false);
  });

  it('the store asks strokesChanged, not the point counts', () => {
    expect(method('applyMegaEraser')).toContain('strokesChanged(before, after)');
  });
});

describe('redo puts the pen pressure back with the stroke', () => {
  it('the redone stroke carries its pressure', () => {
    // Undo kept the stored stroke; redo re-added only its points and tool, so
    // a pressure line came back at one flat width.
    expect(method('redo')).toContain('pressureOf(stroke)');
  });
});

describe('a line drawn far off the sheet still lands', () => {
  const rules = toonopRules({ width: 5, color: '#000000', fill: '#ffffff', smooth: 1, minDistance: 0 });
  const descriptor = { kind: 'pencil', geometry: 'smooth', width: 40, color: '#000000' } as const;
  const sample = (x: number, y: number) => ({ pointerId: 1, isPrimary: true, x, y });

  it('points past int16 are clamped, not the whole stroke thrown away', () => {
    // At 10 % zoom the table runs thousands of pixels past the sheet; a stroke
    // that went there failed the format check and vanished on release.
    const pointer = new PointerStrokeController(() => ({ descriptor, rules }));
    pointer.pointerDown(sample(100, 100));
    pointer.pointerMove(sample(-50000, 100));
    pointer.pointerMove(sample(-50000, 60000));
    pointer.pointerUp(sample(200, 200));
    const stroke = pointer.takeCommitted()!;
    expect(stroke.points.every((v) => v >= STROKE_COORD_MIN && v <= STROKE_COORD_MAX)).toBe(true);
    expect(stroke.points.slice(0, 2)).toEqual([100, 100]);
  });

  it('a stroke over the format limit is cut, keeping its last point', () => {
    const pointer = new PointerStrokeController(() => ({ descriptor, rules }));
    pointer.pointerDown(sample(0, 0));
    for (let i = 1; i < MAX_STROKE_COORDS; i++) pointer.pointerMove(sample(i % 2 ? 0 : 100, i));
    pointer.pointerUp(sample(7, 7));
    const stroke = pointer.takeCommitted()!;
    expect(stroke.points.length).toBeLessThanOrEqual(MAX_STROKE_COORDS);
    expect(stroke.points.slice(-2)).toEqual([7, 7]);
  });
});

describe('the transform history steps by gesture, not by event', () => {
  it('a drag files one step: the moves after the first replace it', () => {
    // Every pointermove pushed a step, so «Шаг назад» after one drag walked
    // back through a hundred positions of it.
    expect(method('setTransform')).toContain('continuing');
    const drag = canvas.match(/function dragTransform[^]*?\n  }\n/)?.[0] ?? '';
    expect(drag).toContain('grab.moved');
  });

  it('typing a number files one step per field, not one per key', () => {
    expect(menu).toContain('typing === field');
  });

  it('a handle dragged onto the centre does not flatten the selection', () => {
    // The fields and keys stop at 1 %; the handle went on to 0 and apply
    // collapsed the selection to a line nothing could grow back.
    const box = { x: 0, y: 0, width: 100, height: 100 };
    const flat = scaledBy(EMPTY_TRANSFORM, box, 'scale-r', { x: 100, y: 50 }, { x: 50, y: 50 }, false);
    expect(Math.abs(flat.scaleX)).toBeGreaterThanOrEqual(0.01);
  });
});

describe('a plugin gesture that wrote nothing files no undo step', () => {
  it('endPluginGesture pushes only after a write', () => {
    // A click with the distort left an empty step on top: the first Ctrl+Z
    // did nothing visible and the redo stack was gone.
    expect(method('endPluginGesture')).toContain('.wrote');
    expect(method('editPluginCells')).toContain('gesture.wrote = true');
  });
});
