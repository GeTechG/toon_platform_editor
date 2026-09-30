import { describe, expect, it } from 'bun:test';
import { stripTail } from './strip-window';

// Seventeenth audit: the timeline, the layers, the sound and the transport.
// Runes components are checked by their source, as in audit16-timeline.test.ts;
// the pure helpers by what they do.
const UI = new URL('./', import.meta.url).pathname;
const timeline = await Bun.file(UI + 'Timeline.svelte').text();
const rows = await Bun.file(UI + 'LayerRows.svelte').text();
const panel = await Bun.file(UI + 'AudioPanel.svelte').text();

/** Тело функции из исходника компонента, до закрывающей скобки. */
function fn(source: string, name: string): string {
  return source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n  }`))?.[0] ?? '';
}

describe('семнадцатый аудит: имена слоёв стоят вровень с ячейками и в конце ленты', () => {
  it('лента без вертикальной прокрутки ничего не добавляет', () => {
    expect(stripTail({ scrollHeight: 200, clientHeight: 200, offsetHeight: 208 }, 170)).toBe(0);
  });

  it('под последним рядом — дорожка волны и полоса прокрутки ленты', () => {
    // Дорожка 20 px с отступом 2 px и полоса 8 px: на 30 px лента уходит дальше списка.
    expect(stripTail({ scrollHeight: 300, clientHeight: 200, offsetHeight: 208 }, 278)).toBe(30);
    // Без звука — только полоса.
    expect(stripTail({ scrollHeight: 300, clientHeight: 200, offsetHeight: 208 }, 300)).toBe(8);
  });

  it('список имён получает то же место снизу, прежде чем берёт прокрутку ленты', () => {
    const body = fn(timeline, 'syncRowScroll');
    expect(body).toMatch(/stripTail\(/);
    expect(body).toMatch(/paddingBottom/);
    expect(body.indexOf('paddingBottom')).toBeLessThan(body.indexOf('to.scrollTop = from.scrollTop'));
  });
});

describe('семнадцатый аудит: перенос слоя держит клавиши студии', () => {
  it('захват ручки держит жест, конец и отмена отпускают', () => {
    expect(fn(rows, 'onHandleDown')).toMatch(/editor\.gestureHeld = true/);
    expect(fn(rows, 'endDrag')).toMatch(/editor\.gestureHeld = false/);
    expect(fn(rows, 'cancelDrag')).toMatch(/editor\.gestureHeld = false/);
  });

  it('клавиши сетки слоёв ждут, пока слой в руке', () => {
    // Alt+↑ посреди переноса двигал слой, а перенос потом брал чужой по старому номеру.
    const body = fn(rows, 'onGridKey');
    expect(body).toMatch(/if \(drag\)/);
    expect(body.indexOf('if (drag)')).toBeLessThan(body.indexOf('e.altKey'));
  });

  it('список, ушедший посреди переноса, возвращает клавиши', () => {
    expect(rows).toMatch(/onDestroy\(\(\) => \{[^}]*gestureHeld = false/);
  });
});

describe('семнадцатый аудит: разделитель колонки виден в контрастной теме', () => {
  it('линия разделителя — CanvasText: фон в этом режиме закрашивается', () => {
    expect(timeline).toMatch(/@media \(forced-colors: active\)[^@]*\.col-resizer::after \{\s*background: CanvasText;/);
  });
});

describe('семнадцатый аудит: трек, который не прочитан, не выдаёт себя за тишину', () => {
  it('длины в плашке — только когда длина трека известна', () => {
    expect(panel).toMatch(/\{#if editor\.audio\.duration > 0\}\s*<p class="lengths">/);
  });

  it('волна под лентой — только у прочитанного трека', () => {
    expect(timeline).toMatch(/const waveBars = \$derived\(editor\.audio\.hasTrack && editor\.audio\.duration > 0/);
  });
});
