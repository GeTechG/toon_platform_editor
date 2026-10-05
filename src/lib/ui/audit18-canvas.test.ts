import { describe, expect, it } from 'bun:test';
import { createSideButtonGuard } from './side-buttons';
import { FrameComposer, type ComposeTarget } from '../render/frame-compose';
import { createDocument } from '../model/operations';

// Восемнадцатый аудит, холст: боковые кнопки мыши, кольцо кисти рядом с
// пальцем и ладонью, снимок панорамы, устаревший под рукой.
// CanvasView — компонент на рунах, поэтому то, что он обязан делать,
// проверяется по его исходнику; чистые правила — вызовом.

const source = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();

function handler(name: string): string {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`нет обработчика ${name}`);
  return match[0];
}

function release(guard: ReturnType<typeof createSideButtonGuard>, type: string, button: number): boolean {
  let prevented = false;
  guard.release({ type, button, preventDefault: () => (prevented = true) });
  return prevented;
}

describe('боковые кнопки мыши', () => {
  // Нажатие, начавшее панораму (рука), отменяет pointerdown — и браузер не
  // шлёт mouseup. Страж снимался только по mouseup и оставался взведён:
  // следующее «назад» где угодно в студии глоталось.
  it('страж снимается и по auxclick: mouseup после отменённого pointerdown не приходит', () => {
    const tasks: (() => void)[] = [];
    const guard = createSideButtonGuard((run) => tasks.push(run));
    guard.press(3);
    expect(release(guard, 'pointerup', 3)).toBe(true);
    expect(release(guard, 'auxclick', 3)).toBe(true);
    for (const run of tasks) run();
    // Уже не на холсте: кнопка листает историю, как всегда.
    expect(release(guard, 'mouseup', 3)).toBe(false);
  });

  it('pointerup страж не снимает: mouseup и auxclick той же кнопки ещё впереди', () => {
    const tasks: (() => void)[] = [];
    const guard = createSideButtonGuard((run) => tasks.push(run));
    guard.press(4);
    release(guard, 'pointerup', 4);
    for (const run of tasks) run();
    expect(release(guard, 'mouseup', 4)).toBe(true);
  });

  // Вторая кнопка, нажатая при зажатой первой, приходит не как pointerdown,
  // а как pointermove с её номером: большой палец задел «назад» посреди
  // линии — и студия уходила со страницы.
  it('боковая кнопка, нажатая посреди штриха, тоже ставит страж', () => {
    const move = handler('onPointerMove');
    expect(move).toContain('sideButtons.press(e.button)');
  });
});

describe('кольцо кисти рядом с пальцем и ладонью', () => {
  // Палец отпустил экран — pointerleave гасил кольцо, а мышь или перо, что
  // всё это время были над холстом, нового pointerenter не получают: при
  // `cursor: none` курсора на холсте не было вовсе, пока не уйдёшь с него.
  it('указатель, который движется над холстом, виден: движение возвращает кольцо', () => {
    const move = handler('onPointerMove');
    expect(move).toMatch(/cursorVisible = true;\s*\n\s*cursorX = e\.clientX;/);
  });

  // Ладонь у работающего пера — не жест (startNavigation) и не курсор: кольцо
  // прыгало под неё с каждым её движением и гасло, когда она поднималась.
  it('ладонь у пера кольцо не двигает, не зажигает и не гасит', () => {
    expect(handler('isPalm')).toMatch(/e\.pointerType === 'touch' && editor\.penSeen && penBusy\(\)/);
    const move = handler('onPointerMove');
    expect(move.indexOf('if (!isPalm(e))')).toBeGreaterThan(-1);
    expect(move.indexOf('if (!isPalm(e))')).toBeLessThan(move.indexOf('cursorX = e.clientX'));
    const enter = source.slice(source.indexOf('onpointerenter='), source.indexOf('onpointerleave='));
    const leave = source.slice(source.indexOf('onpointerleave='), source.indexOf('class:custom-cursor'));
    expect(enter).toContain('if (isPalm(event)) return;');
    expect(leave).toContain('if (isPalm(event)) return;');
  });

  // Shift+перетаскивание пером меняет толщину: лист под кольцом стоит
  // (drawingBusy), а ладонь его двигала — в «занято» пера этого жеста не было.
  it('перо, меняющее толщину Shift-жестом, занято: ладонь лист не двигает', () => {
    expect(handler('penBusy')).toContain('sizing !== null');
  });
});

// Линию под рукой рисует кисть — у плагина это его код. Ластик, упавший
// посреди кадра, оставлял буфер в режиме destination-out: следующий кадр
// клал в него активный слой этим же режимом, и слой пропадал с листа.
describe('линия под рукой, бросившая исключение', () => {
  it('не оставляет буфер стирающим', () => {
    const made: { globalCompositeOperation: string }[] = [];
    const composer = new FrameComposer(() => {
      const ctx = {
        globalCompositeOperation: 'source-over',
        globalAlpha: 1,
        canvas: { width: 0, height: 0 },
        setTransform() {},
        clearRect() {},
        drawImage() {},
      };
      made.push(ctx);
      return { ctx: ctx as unknown as ComposeTarget, image: ctx as unknown as CanvasImageSource, size() {}, clear() {} };
    });
    const doc = createDocument();
    const target = made.length; // the composer's buffers come after this
    const scene = {
      doc, frame: 0, activeLayer: 0, tools: doc.tools,
      viewport: { scale: 1, dpr: 1 },
      live: { id: 1, erase: true, paint: () => { throw new Error('кисть сломалась'); } },
    };
    const onto = { globalAlpha: 1, setTransform() {}, drawImage() {} } as unknown as ComposeTarget;
    expect(() => composer.compose(onto, 10, 10, scene)).toThrow('кисть сломалась');
    expect(made.length).toBeGreaterThan(target);
    expect(made.map((ctx) => ctx.globalCompositeOperation)).not.toContain('destination-out');
  });
});
