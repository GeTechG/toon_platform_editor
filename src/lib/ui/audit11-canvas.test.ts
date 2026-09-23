import { describe, expect, it } from 'bun:test';
import { fitSheet, fitView, resizedView, type Stage } from './viewport';

const source = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();

function handler(name: string): string {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`missing ${name} handler`);
  return match[0];
}

function stageOf(width: number, height: number): Stage {
  const sheet = fitSheet(width, height, { width: 1280, height: 720 });
  return { width, height, sheetWidth: sheet.width, sheetHeight: sheet.height };
}

describe('the sheet when the workspace changes size', () => {
  it('a sheet nobody moved stays whole and in the middle after the phone turns', () => {
    const landscape = stageOf(455, 239);
    const portrait = stageOf(390, 360);
    const view = resizedView(fitView(landscape), landscape, portrait);
    const fitted = fitView(portrait);
    expect(view.zoom).toBe(1);
    expect(view.panX).toBeCloseTo(fitted.panX);
    expect(view.panY).toBeCloseTo(fitted.panY);
  });

  it('a magnified view keeps the point that was in the middle of the screen', () => {
    const from = stageOf(1000, 600);
    const to = stageOf(600, 1000);
    const before = { zoom: 3, panX: -800, panY: -300 };
    const after = resizedView(before, from, to);
    // Where the middle of the old workspace sat along the sheet, 0..1.
    const u = (from.width / 2 - before.panX) / (from.sheetWidth * 3);
    const v = (from.height / 2 - before.panY) / (from.sheetHeight * 3);
    expect((to.width / 2 - after.panX) / (to.sheetWidth * 3)).toBeCloseTo(u);
    expect((to.height / 2 - after.panY) / (to.sheetHeight * 3)).toBeCloseTo(v);
  });

  it('the canvas carries the view over through it, not only clamps it', () => {
    expect(source).toContain('resizedView(editor.view, placedStage, stage)');
  });
});

describe('fingers on the sheet', () => {
  it('a third finger lifting re-bases the pinch on the two left, so the view does not leap', () => {
    const end = handler('endNavigation');
    expect(end).toContain('touches.size === 2');
    expect(end).toContain('gesture = pinchFrom(touches)');
  });

  it('a pen landing stops the palm that was panning or pinching the sheet', () => {
    const down = handler('onPointerDown');
    const pen = down.slice(down.indexOf("e.pointerType === 'pen'"), down.indexOf('startNavigation(e)'));
    expect(pen).toContain('stopTouchNavigation()');
    const stop = handler('stopTouchNavigation');
    expect(stop).toContain('touches.has(panning.pointerId)');
    expect(stop).toContain('gesture = null');
  });
});
