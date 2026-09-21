import { expect, test } from 'bun:test';

import corePlugin from '.';

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

/** A neutral record: the canvas and the ranges of a brush never read it. */
const HAND = { width: 8, color: '#000000', fill: '#ffffff', smooth: 3, minDistance: 3 };

const profiles = await read('../lib/tools/profiles.ts');
const eraser = await read('../lib/tools/mega-eraser.ts');
const canvas = await read('../lib/ui/CanvasView.svelte');

test('the pixel tool brings its own everything', () => {
  const stroke = corePlugin.tools!.pixel.stroke;
  // The primitive is the general stamp; the tool's own shape is the square.
  expect(stroke?.kind).toBe('stamp');
  // The canvas its numbers are on, how points are captured, how they are
  // thinned on commit, what the mega eraser does to them, and the grid — all
  // of it is here, in the plugin.
  expect(stroke?.rules?.(HAND)?.canvas).toBe(1280);
  expect(stroke?.cut).toBe('cells');
  expect(stroke?.grid).toBe(true);
  expect(typeof stroke?.descriptor).toBe('function');
  expect(typeof stroke?.rules?.(HAND)?.capture).toBe('function');
  expect(typeof stroke?.rules?.(HAND)?.prepare).toBe('function');
});

test('the editor knows the pixel only as a thing the renderer draws', () => {
  // The format has the primitive and the renderer draws it — the player needs
  // both, and no plugin runs there. Everything else about the tool is the
  // plugin's, so these files must not name it at all.
  for (const [name, source] of [['profiles.ts', profiles], ['mega-eraser.ts', eraser], ['CanvasView.svelte', canvas]]) {
    expect(`${name}: ${source.includes("'pixel'")}`).toBe(`${name}: false`);
    expect(`${name}: ${source.includes('isPixelTool')}`).toBe(`${name}: false`);
    expect(`${name}: ${source.includes('PixelTool')}`).toBe(`${name}: false`);
  }
});

test('a session that captures itself is the general case, not the pixel case', () => {
  expect(profiles).toContain('own');
  expect(profiles).not.toContain('isPixelSession');
});
