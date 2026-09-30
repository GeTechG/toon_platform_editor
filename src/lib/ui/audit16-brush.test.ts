import { afterEach, describe, expect, it } from 'bun:test';
import { plugins } from '../plugins';
import { PLUGIN_API } from '../plugins/contract';
import { toonopRules } from '../tools/brush';
import { PointerStrokeController } from '../tools/profiles';
import { brushPreview } from './brush-preview';
import { defaultBrushOf } from './presets';

// Sixteenth audit, the brush: the editor brush's simplify stage, the type
// list after its tool changes under it, and plugin brushes that return shapes
// the engine cannot use.
const panel = await Bun.file(new URL('./BrushPanel.svelte', import.meta.url)).text();

const PLUGIN = 'test.audit16-brush';
afterEach(() => plugins.remove(PLUGIN));

/** A plugin brush with a stroke of its own making. */
function brushWith(stroke: Record<string, unknown>): string {
  plugins.register({
    id: PLUGIN,
    api: PLUGIN_API,
    tools: {
      'test.a16-brush': {
        label: 'Кривая', title: 'Кривая', key: '', icon: '<path />',
        stroke: {
          kind: 'pencil',
          descriptor: ({ width, color }: { width: number; color: string }) =>
            ({ kind: 'pencil', geometry: 'smooth', width, color }),
          ...stroke,
        },
      },
    },
  });
  return 'test.a16-brush';
}

/** A half circle of radius 100 px, in document units, sampled every `step` px. */
function arc(step: number): number[] {
  const points: number[] = [];
  const count = Math.round((Math.PI * 100) / step);
  for (let i = 0; i <= count; i++) {
    const a = (Math.PI * i) / count;
    points.push(Math.round((500 + 100 * Math.cos(a)) * 8), Math.round((500 - 100 * Math.sin(a)) * 8));
  }
  return points;
}

describe('упрощение не выпрямляет медленную линию', () => {
  it('полукруг пера на 240 Гц остаётся дугой', () => {
    // 200 px/s at 240 Hz: under a pixel between samples. Each step was
    // measured against the one before it, not the last point kept, so every
    // middle point fell and the arc landed as its chord.
    const rules = toonopRules({ width: 40, color: '#000000', fill: '#ffffff', smooth: 3, minDistance: 3 });
    const kept = rules.prepare!(arc(0.83), 40, 1);
    const topY = Math.min(...kept.filter((_, i) => i % 2 === 1));
    expect(kept.length / 2).toBeGreaterThan(20);
    // The arc's top is 100 px above its ends; the chord never leaves them.
    expect(topY).toBeLessThan(410 * 8);
  });

  it('точки ближе порога к оставленной по-прежнему выпадают', () => {
    const rules = toonopRules({ width: 40, color: '#000000', fill: '#ffffff', smooth: 1, minDistance: 3 });
    // A point every pixel on a straight line: of ten, about every fourth stays.
    const line = Array.from({ length: 11 }, (_, i) => [i * 8, 0]).flat();
    const kept = rules.prepare!(line, 40, 1);
    expect(kept.slice(0, -4)).toEqual([0, 0, 32, 0, 64, 0]);
    expect(kept.slice(-4)).toEqual([80, 0, 80, 0]);
  });
});

describe('список типов, исчезнувший со сменой инструмента', () => {
  it('не остаётся «открытым» и не всплывает сам по возвращении', () => {
    // F with the list open: the list left with the pencil, no toggle came,
    // and the caret stood pointing up; in Safari 16 the list came back open.
    expect(panel).toMatch(/\$effect\(\(\) => \{\s*if \(!hasBrushTypes\(editor\.tool\)\) picking = false;/);
  });
});

describe('кисть плагина с негодным результатом', () => {
  it('commit без массива точек — штрих не ложится, жест не падает', () => {
    const tool = brushWith({
      rules: () => ({
        capture: (_l: readonly number[], batch: readonly number[]) => [...batch],
        commit: () => ({ points: null, tool: { kind: 'pencil', geometry: 'smooth', width: 8, color: '#000000' } }),
      }),
    });
    const stroke = plugins.tool(tool)!.stroke!;
    const brush = { width: 8, color: '#000000', fill: '#ffffff', smooth: 1, minDistance: 0 };
    const pointer = new PointerStrokeController(() => ({
      descriptor: stroke.descriptor(brush), rules: stroke.rules!(brush)!, zoom: 1,
    }));
    const sample = (x: number) => ({ pointerId: 1, isPrimary: true, x, y: 0 });
    pointer.pointerDown(sample(0));
    pointer.pointerMove(sample(80));
    expect(() => pointer.pointerUp(sample(160))).not.toThrow();
    expect(pointer.takeCommitted()).toBeNull();
    // The brush box draws its sample through the same engine.
    expect(() => brushPreview(tool, 'toonop-brush', 4, defaultBrushOf('toonop-brush'))).not.toThrow();
  });

  it('descriptor без объекта — плагин отключается, рисует карандаш', () => {
    const tool = brushWith({ descriptor: () => undefined });
    const made = plugins.tool(tool)!.stroke!.descriptor({
      width: 8, color: '#123456', fill: '#ffffff', smooth: 1, minDistance: 0,
    });
    expect(made).toMatchObject({ kind: 'pencil', width: 8, color: '#123456' });
    expect(() => brushPreview(tool, 'toonop-brush', 4, defaultBrushOf('toonop-brush'))).not.toThrow();
  });
});
