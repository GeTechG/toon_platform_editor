import { describe, expect, it } from 'bun:test';
import { addLayer, addStroke, createDocument } from '../model/operations';
import { FrameComposer, type ComposeBuffer } from '../render/frame-compose';
import { BufferRing } from './buffer-ring';
import { nextHint } from './canvas-hint';

const source = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();

function handler(name: string): string {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`нет обработчика ${name}`);
  return match[0];
}

/** Буфер, который помнит свой размер: освобождённый — это 0×0. */
function sized(log: { width: number; height: number }[]): () => ComposeBuffer {
  return () => {
    const canvas = { width: 0, height: 0 };
    log.push(canvas);
    const ctx = new Proxy({ canvas }, {
      get: (target, key) => (key in target ? (target as Record<string | symbol, unknown>)[key] : () => {}),
      set: () => true,
    });
    return {
      ctx: ctx as unknown as ComposeBuffer['ctx'],
      image: canvas as unknown as CanvasImageSource,
      size(width, height) {
        canvas.width = width;
        canvas.height = height;
      },
      clear() {},
    };
  };
}

describe('колесо и щипок трекпада посреди штриха', () => {
  it('не двигают вид, пока рука ведёт линию, ручку или мега-ластик: иначе линия чертит прямую через лист', () => {
    const wheel = handler('onWheel');
    expect(wheel).toContain('drawingBusy()');
    expect(wheel.indexOf('drawingBusy()')).toBeLessThan(wheel.indexOf('zoomTo('));
    const change = handler('onGestureChange');
    expect(change).toContain('drawingBusy()');
    expect(change.indexOf('drawingBusy()')).toBeLessThan(change.indexOf('zoomTo('));
  });

  it('«занята» — это штрих, ручка трансформации, мега-ластик, жест инструмента или Shift-толщина, но не панорама', () => {
    const busy = handler('drawingBusy');
    for (const part of ['pointer.session', 'grab', 'megaGesture', 'pluginGrab', 'sizing']) {
      expect(busy).toContain(part);
    }
    expect(busy).not.toContain('panning');
  });
});

describe('лист не перевписывается под пальцем', () => {
  it('рейка, появившаяся от первого пальца, не сдвигает лист посреди его штриха — замер ждёт отпускания', () => {
    const measure = handler('measureCovers');
    expect(measure).toContain('drawingBusy()');
    expect(measure).toContain('touches.size > 0');
    expect(measure).toContain('coversStale = true');
    expect(handler('onPointerUp')).toContain('queueMicrotask(settleCovers)');
    expect(handler('onPointerCancel')).toContain('queueMicrotask(settleCovers)');
  });

  it('лист вписывается по размеру документа, а не по каждой записи в него: штрих не переписывает вид', () => {
    expect(source).toContain('const docWidth = $derived(editor.doc.width)');
    expect(source).toContain('const docHeight = $derived(editor.doc.height)');
    const fit = source.slice(source.indexOf('const sheet = $derived('), source.indexOf('const sheetWidth'));
    expect(fit).not.toContain('editor.doc,');
  });
});

describe('подсказка на холсте', () => {
  it('та же фраза второй раз всё равно меняет текст живой области, иначе читалка молчит', () => {
    const first = nextHint('', 'Слой скрыт');
    expect(first).toBe('Слой скрыт');
    const again = nextHint(first, 'Слой скрыт');
    expect(again).not.toBe(first);
    expect(again.trim()).toBe('Слой скрыт');
    expect(nextHint(again, 'Слой скрыт')).toBe(first);
    expect(nextHint(again, 'Другое')).toBe('Другое');
  });

  it('холст зовёт это правило', () => {
    expect(handler('showHint')).toContain('nextHint(hint, message)');
  });
});

describe('холст уходит — память уходит с ним', () => {
  it('композитор отдаёт холсты всех своих буферов, и слои больше не читаются', () => {
    const made: { width: number; height: number }[] = [];
    const doc = createDocument();
    addLayer(doc, 1);
    addStroke(doc, 0, 0, { points: [0, 0, 400, 400], width: 40, color: '#000000' });
    addStroke(doc, 1, 0, { points: [0, 0, 400, 400], width: 40, color: '#000000' });
    const composer = new FrameComposer(sized(made));
    const target = sized([])().ctx as never;
    composer.compose(target, 300, 200, {
      doc, frame: 0, activeLayer: 1, viewport: { scale: 0.1, dpr: 1, panX: 0, panY: 0 }, tools: doc.tools,
      live: { id: 1, paint: () => {} }, alpha: 0.5,
    });
    expect(made.some((c) => c.width === 300)).toBe(true);
    composer.dispose();
    expect(made.every((c) => c.width === 0 && c.height === 0)).toBe(true);
    expect(composer.layers).toBeNull();
  });

  it('кольцо призраков отдаёт все свои буферы и начинает с чистого', () => {
    let made = 0;
    const ring = new BufferRing(2, () => ({ n: made++ }));
    ring.take('a');
    ring.take('b');
    expect(ring.drain().map((b) => b.n)).toEqual([0, 1]);
    expect(ring.take('a').fresh).toBe(true);
    expect(made).toBe(3);
  });

  it('при размонтировании холст отменяет кадр, освобождает композитор, снимок и пипетку', () => {
    const destroy = source.match(/onDestroy\(\(\) => \{[^]*?\n  \}\);/)![0];
    expect(destroy).toContain('cancelAnimationFrame(rafId)');
    expect(destroy).toContain('composer.dispose()');
    expect(destroy).toContain('shotCanvas');
    expect(destroy).toContain('pickEl');
    expect(handler('scheduleDraw')).toContain('rafId = requestAnimationFrame(');
    expect(handler('draw')).toContain('destroyed');
  });
});

describe('пипетка сразу после смены вида', () => {
  // Буферы сборщика держат кусок битмапа листа, а не экран: точка листа под
  // курсором лежит в них на том же месте, что бы вид ни сделал после сборки.
  it('холст читает пиксель листа по куску последнего собранного кадра', () => {
    const pick = handler('pickColor');
    expect(pick).toContain('toDocUnits(e)');
    expect(pick).toContain('* lastRaster.level');
  });
});

describe('образец пипетки у курсора', () => {
  it('гаснет со сменой инструмента: вернувшись к пипетке, не показывает давно взятый цвет', () => {
    expect(source).toMatch(/\$effect\(\(\) => \{\s*void editor\.tool;\s*pickPreview = null;/);
  });
});

describe('лупа удерживаемого пальца', () => {
  it('не уходит за край экрана у правого и левого края', () => {
    expect(source).toContain('function loupeX(');
    expect(source).toContain('translate({loupeX(dropper.x)}px');
    const clamp = handler('loupeX');
    expect(clamp).toContain('window.innerWidth');
  });
});
