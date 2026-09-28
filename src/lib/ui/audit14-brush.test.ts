import { describe, expect, it } from 'bun:test';
import { brushFromStore, FALLBACK_BRUSH } from './presets';

// Fourteenth audit, the brush.
const panel = await Bun.file(new URL('./BrushPanel.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();

function member(source: string, name: string): string {
  const match = source.match(new RegExp(`${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

describe('кисть из черновика проходит те же рамки, что и из настроек', () => {
  // Файл черновика — откуда угодно, а `isDraftState` проверяет лишь, что числа
  // конечны: ширина −5, сглаживание 999 или 2.5 шли в кисть как есть — линия
  // отрицательной толщины, ползунок за краем, дробное число в поле.
  it('держит ширину, сглаживание и упрощение в их шкалах и целыми', () => {
    expect(brushFromStore({ width: -5, smooth: 999, minDistance: -1 }, FALLBACK_BRUSH))
      .toEqual({ width: 1, smooth: 100, minDistance: 0 });
    expect(brushFromStore({ width: 2.6, smooth: 3.2, minDistance: 30.4 }, FALLBACK_BRUSH))
      .toEqual({ width: 3, smooth: 3, minDistance: 30 });
    expect(brushFromStore({ width: 9000 }, FALLBACK_BRUSH).width).toBe(640);
  });

  it('берёт прежнее там, где число не число или его нет', () => {
    const was = { width: 9, smooth: 5, minDistance: 2 };
    expect(brushFromStore({ width: NaN, smooth: 'много' }, was)).toEqual(was);
  });

  it('restoreState пропускает кисть черновика через ту же проверку', () => {
    expect(member(state, 'restoreState')).toContain('brushFromStore(');
  });
});

describe('список типов всегда знает, какой выбран', () => {
  // Тип плагина, у которого нет двойника для инструмента в руке (или плагин
  // убран): кнопка пишет «Обычная», а в списке ни один пункт не нажат — и
  // открытый список не принимал фокус, стрелкам было не с чего начать.
  it('нажат пункт, который показывает кнопка', () => {
    expect(panel).toMatch(/class:active=\{current\.id === option\.id\}/);
    expect(panel).toMatch(/aria-pressed=\{current\.id === option\.id\}/);
  });
});

describe('список типов там, где popover ещё нет', () => {
  // Safari до 17 и Firefox до 125 не знают `popover`: список стоял открытым
  // в левом верхнем углу экрана поверх холста, а выбор типа падал на
  // `hidePopover is not a function`.
  it('проверяет, есть ли popover, и закрывает список без него', () => {
    expect(panel).toMatch(/'popover' in HTMLElement\.prototype/);
    expect(panel).not.toMatch(/list\?\.hidePopover\(\);\n\s*\}\}/);
  });

  it('без popover список скрыт, пока его не открыли кнопкой', () => {
    expect(panel).toMatch(/\.types\.fallback \{[^}]*display: none/);
    expect(panel).toMatch(/\.types\.fallback\.open \{[^}]*display: grid/);
  });
});

describe('список типов не мелькает в углу при первом открытии', () => {
  // `toggle` приходит отдельной задачей, уже после показа: первый кадр список
  // стоял там, где его оставили, — в первый раз в точке 0,0.
  it('ставится к кнопке ещё до показа', () => {
    expect(panel).toMatch(/onbeforetoggle=/);
  });
});

describe('поля чисел на телефоне', () => {
  // Все числа кисти — целые и неотрицательные: iOS на `type=number` открывает
  // полную клавиатуру, а нужна цифровая.
  it('просят цифровую клавиатуру', () => {
    expect(panel).toMatch(/type="number"[^>]*inputmode="numeric"/);
  });
});

describe('упрощение говорит читалке, в чём оно', () => {
  // Минимальное расстояние между точками — логические пиксели, как толщина,
  // а читалка слышала голое «3»: три чего?
  it('ползунок упрощения произносит пиксели', () => {
    expect(panel).toMatch(/aria-valuetext=\{pixels \? t\('brush\.size_value', \{ count: value \}\) : undefined\}/);
    expect(panel).toMatch(/editor\.setBrushMinDistance\(v\), false, true\)/);
  });
});

describe('подсказка ушедшего заголовка не всплывает сама', () => {
  // Открыл «i» у «Сглаживания», сменил кисть на ту, где сглаживания нет, —
  // заголовок ушёл вместе с кнопкой, и blur не пришёл (Chrome его не шлёт при
  // удалении, Safari не фокусирует кнопку по нажатию). Вернулся к карандашу —
  // подсказка уже открыта, хотя её никто не нажимал.
  it('закрывается, когда её заголовок исчез', () => {
    expect(panel).toMatch(/if \(!editor\.brushSmooths && openNote !== t\('brush\.thickness'\)\) openNote = null;/);
  });
});
