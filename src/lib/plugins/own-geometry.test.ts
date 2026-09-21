/**
 * The promise the whole contract rests on: a brush nobody in the editor knows
 * about can bring its own rules and its own geometry, and the player draws its
 * stroke with core code alone.
 *
 * The brush here is deliberately unlike either of the shipped ones — it
 * collects every sample, keeps the ends, and lays the line down as explicit
 * cubic control points.
 */

import { describe, expect, it } from 'bun:test';
import { addStroke, createDocument } from '../model/operations';
import { canonicalize } from '../format/canonical';
import { loadDocument, validateDocument } from '../format/validate';
import type { ToolDescriptor } from '../format/types';
import { Canvas2DFrameRenderer, type Canvas2DLike } from '../render/canvas2d';
import { PLUGIN_API, type Plugin, type StrokeRules } from './contract';
import { PluginRegistry } from './registry';
import {
  PointerStrokeController,
  type PointerSample,
} from '../tools/profiles';

/** A curve of explicit control points: every segment bulges to one side. */
const ribbonRules: StrokeRules = {
  canvas: 800,
  capture: (line, batch) => [...line, ...batch],
  path: (points) => {
    if (points.length < 4) return [...points];
    const out = [points[0], points[1]];
    for (let i = 2; i + 1 < points.length; i += 2) {
      const [px, py] = [points[i - 2], points[i - 1]];
      const [x, y] = [points[i], points[i + 1]];
      out.push(px, py - 20, x, y - 20, x, y);
    }
    return out;
  },
};

const ribbon: Plugin = {
  id: 'ribbon',
  api: PLUGIN_API,
  tool: {
    icon: '<svg viewBox="0 0 16 16"></svg>',
    title: 'Лента',
    label: 'Лента',
    key: 'R',
    stroke: {
      kind: 'pencil',
      rules: () => ribbonRules,
      descriptor: ({ width, color }) => ({ kind: 'pencil', geometry: 'cubic', width, color }),
    },
  },
};

class Recorder implements Canvas2DLike {
  log: string[] = [];
  canvas = { width: 600, height: 300 };
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  lineWidth = 0;
  strokeStyle = '';
  fillStyle = '';
  lineCap = '';
  lineJoin = '';
  setTransform() {}
  fillRect() {}
  clearRect() {}
  drawImage() {}
  beginPath() {}
  arc() {}
  fill() {}
  stroke() {}
  save() {}
  restore() {}
  moveTo(x: number, y: number) { this.log.push(`M ${x} ${y}`); }
  lineTo(x: number, y: number) { this.log.push(`L ${x} ${y}`); }
  quadraticCurveTo(a: number, b: number, x: number, y: number) { this.log.push(`Q ${a} ${b} ${x} ${y}`); }
  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) {
    this.log.push(`C ${a} ${b} ${c} ${d} ${x} ${y}`);
  }
}

const sample = (x: number, y: number): PointerSample => ({ pointerId: 1, isPrimary: true, x, y });

describe('a brush the editor never heard of', () => {
  it('registers like any other and brings its own rules', () => {
    const registry = new PluginRegistry();
    expect(registry.register(ribbon)).toBeNull();
    expect(registry.tool('ribbon')?.stroke?.rules?.()?.canvas).toBe(800);
  });

  it('lands a stroke of its own geometry that the format accepts', () => {
    const controller = new PointerStrokeController(() => ({
      descriptor: { kind: 'pencil', geometry: 'cubic', width: 32, color: '#123456' },
      rules: ribbonRules,
    }));
    controller.pointerDown(sample(0, 100));
    controller.pointerMove(sample(80, 100));
    controller.pointerUp(sample(160, 100));
    const stroke = controller.takeCommitted();
    expect(stroke).not.toBeNull();

    const doc = createDocument();
    addStroke(doc, 0, 0, stroke!);
    expect(validateDocument(doc).ok).toBe(true);
    expect(doc.tools[0]).toEqual({
      kind: 'pencil', geometry: 'cubic', width: 32, color: '#123456',
    } as ToolDescriptor);
    // Two segments of six numbers each, after the starting point.
    expect(doc.layers[0].frames[0].strokes[0].points).toHaveLength(2 + 12);
  });

  it('is drawn by the renderer the player uses, with no plugin code in sight', () => {
    const controller = new PointerStrokeController(() => ({
      descriptor: { kind: 'pencil', geometry: 'cubic', width: 32, color: '#123456' },
      rules: ribbonRules,
    }));
    controller.pointerDown(sample(0, 100));
    controller.pointerMove(sample(80, 100));
    controller.pointerUp(sample(160, 100));
    const doc = createDocument();
    addStroke(doc, 0, 0, controller.takeCommitted()!);

    // Through a round trip, so what is drawn is what a published file holds.
    const published = loadDocument(JSON.parse(canonicalize(doc)));
    const ctx = new Recorder();
    new Canvas2DFrameRenderer().render(published, 0, ctx, { scale: 1, dpr: 1 });

    expect(ctx.log).toEqual([
      'M 0 100',
      'C 0 80 80 80 80 100',
      'C 80 80 160 80 160 100',
    ]);
  });
});
