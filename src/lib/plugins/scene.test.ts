import { describe, expect, test } from 'bun:test';

import type { ToonDocument } from '../format/types';
import type { PluginCanvas } from './contract';
import { makeScene } from './scene';

/** A canvas that writes down what it was told, and the state at each draw. */
function recorder(): PluginCanvas & { calls: string[] } {
  const calls: string[] = [];
  const canvas = {
    calls,
    globalCompositeOperation: 'source-over',
    lineWidth: 1,
    strokeStyle: '#000000',
    fillStyle: '#000000',
    lineCap: 'butt',
    lineJoin: 'miter',
    setTransform: (...args: number[]) => calls.push(`setTransform ${args.join(' ')}`),
    beginPath: () => calls.push('beginPath'),
    moveTo: (x: number, y: number) => calls.push(`moveTo ${x} ${y}`),
    lineTo: (x: number, y: number) => calls.push(`lineTo ${x} ${y}`),
    quadraticCurveTo: (...args: number[]) => calls.push(`quadraticCurveTo ${args.join(' ')}`),
    bezierCurveTo: (...args: number[]) => calls.push(`bezierCurveTo ${args.join(' ')}`),
    arc: (...args: number[]) => calls.push(`arc ${args.slice(0, 3).join(' ')}`),
    fill: () => calls.push(`fill ${canvas.fillStyle} ${canvas.globalCompositeOperation}`),
    stroke: () => calls.push(`stroke ${canvas.strokeStyle} ${canvas.lineWidth} ${canvas.globalCompositeOperation}`),
    fillRect: (...args: number[]) => calls.push(`fillRect ${args.join(' ')}`),
  };
  return canvas;
}

function doc(): ToonDocument {
  const cell = (tool_id: number, points: number[]) => ({ strokes: [{ tool_id, points }] });
  return {
    schema_version: 8,
    width: 800,
    height: 600,
    frame_rate: 12,
    tools: [
      { kind: 'pencil', geometry: 'smooth', width: 40, color: '#ff0000' },
      { kind: 'eraser', geometry: 'line', width: 16 },
    ],
    layers: [
      { hidden: false, frames: [cell(0, [0, 0, 80, 80, 160, 0]), cell(0, [8, 8, 16, 16])] },
      { hidden: true, frames: [cell(0, [1, 1, 2, 2]), cell(0, [1, 1, 2, 2])] },
      { hidden: false, frames: [cell(1, [10, 10, 20, 20]), { strokes: [] }] },
    ],
  };
}

describe('the scene a format reads', () => {
  test('carries the canvas, the frames and the visible layers', () => {
    const scene = makeScene(doc(), 1);

    expect([scene.width, scene.height, scene.frameRate, scene.frames, scene.frame]).toEqual([800, 600, 12, 2, 1]);
    expect(scene.layers).toBe(2);
    expect(scene.background).toBe('#ffffff');
  });

  test('draws a cell with the renderer, in document units', () => {
    const canvas = recorder();

    makeScene(doc(), 0).draw(0, 0, canvas);

    expect(canvas.calls).toEqual([
      'setTransform 1 0 0 1 0 0',
      'beginPath',
      'moveTo 0 0',
      'quadraticCurveTo 80 80 160 0',
      'stroke #ff0000 40 source-over',
    ]);
  });

  test('a vector exporter can wrap consecutive flat strokes in one opacity group', () => {
    const canvas = recorder();
    const groups: number[] = [];
    canvas.withOpacityGroup = (alpha, draw) => { groups.push(alpha); draw(); };
    const film = doc();
    film.tools[0] = { kind: 'pencil', geometry: 'line', width: 4, color: '#ff0000', opacity: 50, buildup: false };
    film.layers[0].frames[0]!.strokes.push({ points: [0, 80, 80, 0], tool_id: 0 });
    makeScene(film, 0).draw(0, 0, canvas);
    expect(groups).toEqual([0.5]);
    expect(canvas.calls.filter((call) => call.startsWith('stroke '))).toHaveLength(2);
  });

  test('a hidden layer is not there: the second visible one is the top one', () => {
    const canvas = recorder();

    makeScene(doc(), 0).draw(1, 0, canvas);

    expect(canvas.calls).toContain('stroke #000000 16 destination-out');
  });

  test('a layer or a frame out of range draws nothing', () => {
    const canvas = recorder();
    const scene = makeScene(doc(), 0);

    scene.draw(2, 0, canvas);
    scene.draw(0, 5, canvas);
    scene.draw(-1, 0, canvas);

    expect(canvas.calls).toEqual([]);
  });
});

describe('a continuation in the scene', () => {
  test('is drawn as the drawing it continues', () => {
    const film = doc();
    film.layers = [{ hidden: false, frames: [film.layers[0].frames[0], null, null] }];
    const held = recorder();
    const drawn = recorder();

    const scene = makeScene(film, 0);
    scene.draw(0, 2, held);
    scene.draw(0, 0, drawn);

    expect(scene.frames).toBe(3);
    expect(held.calls).toEqual(drawn.calls);
    expect(held.calls).toContain('stroke #ff0000 40 source-over');
  });
});
