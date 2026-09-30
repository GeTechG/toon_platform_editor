import { describe, expect, it } from 'bun:test';
import { trackpadScroll } from './viewport';

const source = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
const editorView = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

function handler(name: string): string {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`нет обработчика ${name}`);
  return match[0];
}

const wheel = (deltaX: number, deltaY: number, deltaMode = 0) => ({ deltaX, deltaY, deltaMode });

describe('трекпад двигает лист, колесо мыши масштабирует', () => {
  it('колесо мыши — строки или крупный шаг без deltaX — это зум ступенями', () => {
    expect(trackpadScroll(wheel(0, 3, 1), false)).toBe(false);
    expect(trackpadScroll(wheel(0, -100, 0), false)).toBe(false);
    expect(trackpadScroll(wheel(0, 120, 0), false)).toBe(false);
  });

  it('две пальца по трекпаду — мелкие пиксели или сдвиг вбок — это панорама', () => {
    expect(trackpadScroll(wheel(0, 4, 0), false)).toBe(true);
    expect(trackpadScroll(wheel(0, -1.5, 0), false)).toBe(true);
    expect(trackpadScroll(wheel(12, 0, 0), false)).toBe(true);
    expect(trackpadScroll(wheel(-3, 80, 0), false)).toBe(true);
  });

  it('разгон в конце броска (крупные дельты внутри потока) остаётся панорамой, строки — никогда', () => {
    expect(trackpadScroll(wheel(0, 80, 0), true)).toBe(true);
    expect(trackpadScroll(wheel(0, 3, 1), true)).toBe(false);
  });

  it('холст панорамирует трекпадом на расстояние дельт, а колесо по-прежнему идёт ступенями', () => {
    const onWheel = handler('onWheel');
    expect(onWheel).toContain('trackpadScroll(');
    expect(onWheel).toContain('panBy(-e.deltaX, -e.deltaY)');
    expect(onWheel).toContain('wheelNotch(wheelRest, e.deltaY, e.deltaMode)');
    // Щипок (Ctrl+колесо) решается раньше панорамы.
    expect(onWheel.indexOf('e.ctrlKey')).toBeLessThan(onWheel.indexOf('panBy('));
  });

  it('посреди штриха вид не двигается ни панорамой, ни зумом', () => {
    const onWheel = handler('onWheel');
    expect(onWheel.indexOf('drawingBusy()')).toBeLessThan(onWheel.indexOf('panBy('));
  });
});

describe('во время просмотра жесты вида работают', () => {
  it('колесо и трекпад не глушатся просмотром', () => {
    expect(handler('onWheel')).not.toContain('editor.playing');
  });

  it('щипок Safari (gesture*) не глушится просмотром', () => {
    expect(handler('onGestureChange')).not.toContain('editor.playing');
  });

  it('два пальца и рука начинают навигацию раньше запрета рисовать при просмотре', () => {
    const down = handler('onPointerDown');
    expect(down.indexOf('startNavigation(e)')).toBeLessThan(down.indexOf('editor.playing ||'));
  });
});

describe('рейка толщины над окном вкладки стоящего телефона', () => {
  it('сцена знает, что окно открыто снизу', () => {
    expect(editorView).toMatch(/class:low-window=\{!!shownTab && tall\}/);
  });

  it('низ рейки поднимается над окном (до 55% сцены), и вся шкала достижима', () => {
    const rule = editorView.match(/\.stage\.low-window :global\(\.size-rail\) \{[^}]*\}/);
    expect(rule).not.toBeNull();
    // Или выше, если на окне стоит окно инструмента (audit16-system).
    expect(rule![0]).toMatch(/bottom: calc\((max\()?55%[^;]*\+ [\d.]+rem\)/);
    // Окно не выше 55% сцены — иначе рейка снова уйдёт под него.
    expect(editorView).toMatch(/\.tab-window \{[^}]*max-height: 55%;/);
  });
});
