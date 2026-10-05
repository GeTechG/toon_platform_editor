import { describe, expect, it } from 'bun:test';
import { addStroke, createDocument } from '../model/operations';
import { FrameComposer, type ComposeBuffer } from '../render/frame-compose';

const source = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();

function handler(name: string): string {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`нет обработчика ${name}`);
  return match[0];
}

/** Буферы, которые считают, сколько раз в них рисовали. */
function counted(log: { paints: number }[]): () => ComposeBuffer {
  return () => {
    const entry = { paints: 0 };
    log.push(entry);
    const canvas = { width: 0, height: 0 };
    const ctx = new Proxy({ canvas }, {
      get: (target, key) => {
        if (key in target) return (target as Record<string | symbol, unknown>)[key];
        if (key === 'stroke' || key === 'fill') return () => { entry.paints += 1; };
        return () => {};
      },
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

describe('сбой посреди кадра не копит клип', () => {
  it('сбой посреди сборки оставляет лист несобранным: следующий кадр собирает его заново, а клипа, который мог бы остаться, нет', () => {
    const draw = handler('draw');
    expect(draw.indexOf('sheetStale = false')).toBeGreaterThan(draw.indexOf('composer.compose('));
    expect(draw).not.toContain('ctx.save()');
    expect(draw).not.toContain('ctx.clip()');
  });

  it('контекста нет (Safari упёрся в память холстов) — кадр не рисуется, а не падает в каждом rAF', () => {
    const draw = handler('draw');
    expect(draw).toMatch(/if \(!ctx\) \{?\s*return;?/);
    expect(draw.indexOf('if (!ctx)')).toBeLessThan(draw.indexOf('ctx.setTransform'));
  });

});

describe('потерянный контекст холста', () => {
  it('после contextrestored буферы сбрасываются и кадр собирается заново: иначе лист пуст, пока его не тронут', () => {
    expect(source).toContain("'contextrestored'");
    const restored = handler('onContextRestored');
    expect(restored).toContain('composer.dispose()');
    expect(restored).toContain('scheduleDraw()');
  });

  it('dispose() забывает и призраков луковой кожи: восстановленный буфер призрака пуст и перерисовывается', () => {
    const base = createDocument();
    addStroke(base, 0, 0, { points: [10, 10, 200, 200], width: 40, color: '#000000' });
    const doc = { ...base, layers: [{ ...base.layers[0], frames: [...base.layers[0].frames, { strokes: [] }] }] };
    const log: { paints: number }[] = [];
    const composer = new FrameComposer(counted(log));
    const target = new Proxy({ canvas: { width: 10, height: 10 }, globalAlpha: 1 }, {
      get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : () => {}),
      set: () => true,
    });
    const scene = {
      doc,
      frame: 1,
      activeLayer: 0,
      viewport: { scale: 1, dpr: 1 },
      tools: doc.tools,
      ghosts: { frames: [{ index: 0, alpha: 0.3 }], layers: [0] },
    };
    composer.compose(target as never, 10, 10, scene);
    const first = log.reduce((sum, b) => sum + b.paints, 0);
    expect(first).toBeGreaterThan(0);
    composer.dispose();
    composer.compose(target as never, 10, 10, scene);
    const second = log.reduce((sum, b) => sum + b.paints, 0) - first;
    // Призрак снова нарисован, а не взят из кэша пустым.
    expect(second).toBe(first);
  });
});

describe('долгое касание листа на iOS', () => {
  it('удержание пальца (пипетка) не выделяет текст и не зовёт системное меню', () => {
    const wrap = source.match(/\n  \.wrap \{[^}]*\}/)?.[0] ?? '';
    expect(wrap).toContain('-webkit-touch-callout: none');
    expect(wrap).toContain('-webkit-user-select: none');
    expect(wrap).toContain('user-select: none');
  });
});

describe('колесо и щипок над рейкой толщины', () => {
  it('ловятся всей сценой, а не только canvas: Ctrl+колесо и щипок трекпада над рейкой масштабировали страницу', () => {
    expect(source).toMatch(/<div\s+class="wrap"[^>]*onwheel=\{onWheel\}/);
    expect(source).not.toMatch(/<canvas[^>]*onwheel=/);
    // The stage around the wrap since the owner's answers after the sixteenth audit.
    expect(source).toMatch(/\$effect\(\(\) => \{\n\s*const el = stageEl\(\);[^]*?gesturestart/);
    expect(source).toContain('return wrapEl?.parentElement ?? wrapEl;');
  });
});
