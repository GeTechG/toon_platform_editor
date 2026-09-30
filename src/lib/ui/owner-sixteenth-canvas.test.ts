import { describe, expect, it } from 'bun:test';

// Owner's answers after the sixteenth audit, the canvas and the view: where
// the zoom buttons and +/- zoom, and a pinch or Ctrl+wheel over the windows
// that float on the stage. CanvasView is a runes component, so what it must
// do is asserted on its source.

const source = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();

describe('кнопки зума и +/- после ухода курсора с холста', () => {
  it('курсор ушёл с холста — точка забыта, и зум идёт вокруг середины вида', () => {
    const leave = source.slice(source.indexOf('onpointerleave={'));
    expect(leave.slice(0, leave.indexOf('}}'))).toContain('editor.lastScalePivot = null');
  });

  it('пока курсор над холстом, зум идёт вокруг него', () => {
    expect(source).toContain('editor.lastScalePivot = { x: e.clientX - rect.left, y: e.clientY - rect.top }');
  });
});

describe('Ctrl+колесо и щипок над окнами на сцене', () => {
  it('жесты Safari ловит вся сцена с её окнами, а не только холст', () => {
    const effect = source.slice(source.indexOf("addEventListener('gesturestart'") - 400);
    expect(effect).toMatch(/const el = stageEl\(\);/);
  });

  it('Ctrl+колесо над окном масштабирует лист; простая прокрутка окна остаётся окну', () => {
    const over = source.match(/function onStageWheel\([^]*?\n  }/)?.[0] ?? '';
    expect(over).toMatch(/!\(e\.ctrlKey \|\| e\.metaKey\)/);
    expect(over).toContain('wrapEl.contains(e.target as Node)');
    expect(over).toContain('onWheel(e)');
    expect(source).toMatch(/addEventListener\('wheel', onStageWheel, \{ passive: false \}\)/);
  });
});
