import { describe, expect, it } from 'bun:test';

// Sixteenth audit, the canvas and the view: the drawing surface, the sheet on
// its table, zoom and pan, pointer/pen/touch input, the pipette's read-back,
// the thickness rail over the stage and a plugin tool's gesture on the sheet.
// CanvasView and TransformMenu are runes components, so what they must do is
// asserted on their source.

const source = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
const transformMenu = await Bun.file(new URL('./TransformMenu.svelte', import.meta.url)).text();

function handler(name: string): string {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`нет обработчика ${name}`);
  return match[0];
}

describe('пипетка, которой нечего прочесть', () => {
  it('без контекста 1×1 (Safari упёрся в память холстов) не падает в обработчике нажатия', () => {
    const pick = handler('pickColor');
    const ctxAt = pick.indexOf("getContext('2d'");
    expect(ctxAt).toBeGreaterThan(-1);
    expect(pick.slice(ctxAt)).toMatch(/if \(!pctx\) \{?\s*return undefined;?/);
  });

  it('«не прочла» — не «пусто»: кадр ещё не собран или контекста нет — ластик не берётся', () => {
    const pick = handler('pickColor');
    expect(pick).toMatch(/if \(!layers \|\| !lastDrawn\) \{?\s*return undefined;?/);
    const take = handler('takeColour');
    expect(take).toMatch(/picked === undefined/);
    expect(take.indexOf('picked === undefined')).toBeLessThan(take.indexOf("selectTool('eraser')"));
  });

  it('палец-пипетка тоже молчит, а не говорит «здесь пусто», когда прочесть нечего', () => {
    const finish = handler('finishDropper');
    expect(finish).toMatch(/picked === undefined/);
    expect(finish.indexOf('picked === undefined')).toBeLessThan(finish.indexOf("t('canvas.hold_empty')"));
  });
});

// Alt+← — «назад» браузера, Ctrl+Shift+стрелки — панорама листа: рейка
// толщины в фокусе забирала их себе и меняла толщину.
describe('стрелки с модификатором рейку толщины не двигают', () => {
  it('Ctrl, Alt и Cmd со стрелкой уходят мимо рейки', () => {
    const key = handler('onRailKey');
    expect(key).toContain('e.ctrlKey || e.altKey || e.metaKey');
    expect(key.indexOf('e.ctrlKey')).toBeLessThan(key.indexOf('e.preventDefault()'));
  });
});

describe('образец пипетки у курсора в контрастной теме', () => {
  it('показывает цвет рисунка, а не системный фон: forced colors перекрашивал его в Canvas', () => {
    const rule = source.slice(source.indexOf('.pick-preview {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('forced-color-adjust: none');
  });
});

describe('клавиши зума в окне трансформации', () => {
  it('на пределе остаются в фокусе (aria-disabled), а не роняют его на body, как disabled', () => {
    const row = transformMenu.slice(transformMenu.indexOf('class="row zoom"'));
    const keys = row.slice(0, row.indexOf('</div>'));
    expect(keys).not.toMatch(/\sdisabled=\{/);
    expect(keys).toContain('aria-disabled={editor.view.zoom <= ZOOM_MIN}');
    expect(keys).toContain('aria-disabled={editor.view.zoom >= ZOOM_MAX}');
    expect(transformMenu).toMatch(/\[aria-disabled='true'\]\s*\{[^}]*opacity/);
  });
});

describe('инструмент плагина, упавший посреди жеста', () => {
  it('release, бросивший исключение, всё равно отпускает холст и закрывает шаг отмены', () => {
    // Иначе pluginGrab оставался: колесо и щипок молчали навсегда, а каждое
    // движение мыши без кнопки звало onPointerUp и падало снова.
    const release = handler('releasePluginGrab');
    expect(release.indexOf('pluginGrab = null')).toBeLessThan(release.indexOf('.release?.('));
    expect(release).toMatch(/try \{[^]*\.release\?\.\([^]*\} finally \{\s*editor\.endPluginGesture\(\);/);
    expect(handler('onPointerUp')).toContain('releasePluginGrab()');
    expect(handler('dropOwnGesture')).toContain('releasePluginGrab()');
  });

  it('press, бросивший исключение, не оставляет жест плагина открытым', () => {
    const down = handler('onPointerDown');
    expect(down).toMatch(/try \{\s*spec\.press\([^]*\} catch \(err\) \{\s*editor\.endPluginGesture\(\);\s*throw err;/);
  });
});

describe('штрих, который не лёг', () => {
  it('неожиданная ошибка записи попадает в журнал ошибок, а не только в консоль', () => {
    const commit = handler('commitPendingStroke');
    expect(commit).toContain('reportError(err)');
    expect(commit).not.toContain('console.warn');
  });
});
