import { describe, expect, it } from 'bun:test';
import { stripTabStop } from './strip-window';

// Seventeenth audit, what was left over: the strip's Tab stop under the
// window of built frames, and the frame menu under a scroll or a resize.
// Runes components are checked by their source, as in audit17-timeline.test.ts;
// the pure helpers by what they do.
const UI = new URL('./', import.meta.url).pathname;
const timeline = await Bun.file(UI + 'Timeline.svelte').text();

/** Тело функции из исходника компонента, до закрывающей скобки. */
function fn(source: string, name: string): string {
  return source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n  }`))?.[0] ?? '';
}

describe('остаток семнадцатого аудита: у ленты всегда есть точка Tab', () => {
  // Ячейка 40 px, зазор 2: шаг 42. Окно — ленте видно 420 px.
  it('построенная активная ячейка и есть точка Tab', () => {
    expect(stripTabStop(5, 100, 40, 2, 0, 420)).toBe(5);
    // Активная в запасе окна, за краем видимого, — всё равно построена.
    expect(stripTabStop(15, 100, 40, 2, 0, 420)).toBe(15);
  });

  it('активная за окном справа — точка на первой видимой ячейке', () => {
    // Прокрутка ушла к 50-му кадру, активный — 2-й: окно его не строит.
    expect(stripTabStop(2, 100, 40, 2, 50 * 42, 420)).toBe(50);
  });

  it('активная за окном слева — тоже первая видимая', () => {
    expect(stripTabStop(95, 100, 40, 2, 10 * 42 + 5, 420)).toBe(11);
  });

  it('без раскладки и без кадров — активная', () => {
    expect(stripTabStop(3, 10, 40, 2, 0, 0)).toBe(3);
  });

  it('первая видимая не уходит за последний кадр', () => {
    expect(stripTabStop(0, 60, 40, 2, 100 * 42, 420)).toBe(59);
  });

  it('лента отдаёт tabindex 0 точке, а не только активной ячейке', () => {
    expect(timeline).toMatch(/stripTabStop\(/);
    expect(timeline).toMatch(/tabindex=\{i === tabFrame && layerIndex === editor\.activeLayer \? 0 : -1\}/);
  });
});

describe('остаток семнадцатого аудита: меню кадра уходит с прокруткой и сменой окна', () => {
  it('прокрутка ленты закрывает меню и возвращает фокус без прокрутки назад', () => {
    const body = fn(timeline, 'syncRowScroll');
    expect(body).toMatch(/closeMenu\(true, true\)/);
    // Своя прокрутка при открытии (активный кадр въехал в вид) меню не закрывает.
    expect(body).toMatch(/menu\.scroll/);
    expect(fn(timeline, 'showMenu')).toMatch(/scroll: /);
  });

  it('смена размера окна закрывает меню', () => {
    expect(timeline).toMatch(/<svelte:window[^\n]*onresize=\{\(\) => closeMenu\(true, true\)\}/);
  });

  it('фокус возвращается и на снятую окном ячейку — на активную', () => {
    const body = fn(timeline, 'closeMenu');
    expect(body).toMatch(/isConnected/);
    expect(body).toMatch(/preventScroll/);
  });
});
