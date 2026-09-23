import { describe, expect, it } from 'bun:test';
import { zoomDelta } from './viewport';

const source = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();

function handler(name: string): string {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`missing ${name} handler`);
  return match[0];
}

describe('a zoom step from a zoom a pinch left between the notches', () => {
  const step = (zoom: number, direction: number): number =>
    Math.round((zoom + zoomDelta(zoom, direction)) * 100) / 100;

  it('lands on the nearest notch past it, not a notch further', () => {
    // 104% after a pinch: out used to add -0.5 and land on 50%.
    expect(step(1.04, -1)).toBe(1);
    // 140%: out used to land on 90%, skipping 100%.
    expect(step(1.4, -1)).toBe(1);
    // 126%: in used to land on 200%, skipping 150%.
    expect(step(1.26, 1)).toBe(1.5);
    expect(step(0.95, 1)).toBe(1);
    expect(step(0.14, -1)).toBe(0.1);
    expect(step(9.8, 1)).toBe(10);
  });

  it('keeps the ladder from a notch', () => {
    expect(step(1, 1)).toBe(1.5);
    expect(step(1, -1)).toBe(0.9);
    expect(step(0.5, 1)).toBe(0.6);
    expect(step(2, -1)).toBe(1.5);
  });
});

describe('the wheel over the canvas', () => {
  it('raises the zoom window for its two seconds after a zoom', () => {
    expect(handler('onWheel')).toContain('editor.flashScaleMenu()');
  });

  it('a trackpad pinch (Ctrl+wheel) moves the grabbed picture instead of rebuilding every layer per event', () => {
    const wheel = handler('onWheel');
    expect(wheel).toContain('takeNavShot()');
    expect(handler('navigating')).toContain('wheelZoomTimer');
  });

  it('a press ends the pinch picture, so a stroke is never drawn under a stale shot', () => {
    const down = handler('onPointerDown');
    expect(down.indexOf('endWheelZoom()')).toBeGreaterThan(down.indexOf('startNavigation(e)'));
  });
});

describe('the pipette', () => {
  it('a press on the table beside the sheet takes nothing and does not arm the eraser', () => {
    const down = handler('onPointerDown');
    const pipette = down.slice(down.indexOf("editor.tool === 'pipette'"), down.indexOf("editor.selectTool('eraser')"));
    expect(pipette).toContain('offSheet(');
  });

  it('reads one pixel through a 1×1 scratch, not a stage-sized copy of the frame', () => {
    const pick = handler('pickColor');
    expect(pick).toContain('buffer(pickEl, 1, 1)');
    expect(pick).toContain('-px, -py');
  });
});
