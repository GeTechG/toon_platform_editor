import { describe, expect, it } from 'bun:test';
import { SAVED_PALETTE_MAX, paletteFromStore, pressesCell, quickColours } from './color-palette';

const read = (name: string) => Bun.file(new URL(name, import.meta.url)).text();
const palette = await read('./PaletteBox.svelte');
const panel = await read('./ColorPanel.svelte');
const state = await read('./editor-state.svelte.ts');
const colours = await read('./color-palette.ts');
const ru = await Bun.file(new URL('../i18n/ru.json', import.meta.url)).json();

const fn = (source: string, name: string) => source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n  \\}`))?.[0] ?? '';

describe('пятнадцатый аудит: цвет', () => {
  it('отпущенный после долгого нажатия палец не жмёт ячейку ни mousedown, ни click', () => {
    // iOS шлёт совместимые mousedown и click после touchend: с отметкой «mouse»
    // mousedown клал цвет и в контур, а в режиме удаления убирал ещё и ячейку,
    // съехавшую на место удалённой.
    expect(pressesCell('mousedown', 'held', 1)).toBe(false);
    expect(pressesCell('click', 'held', 1)).toBe(false);
    // Клавиша по-прежнему жмёт всегда, мышь и палец — как раньше.
    expect(pressesCell('click', 'held', 0)).toBe(true);
    expect(pressesCell('mousedown', 'mouse', 1)).toBe(true);
    expect(pressesCell('click', 'touch', 1)).toBe(true);
    expect(pressesCell('click', 'mouse', 1)).toBe(false);
    expect(palette).not.toMatch(/^\s+pointerKind = 'mouse';/m);
    expect(palette.match(/pointerKind = 'held'/g)?.length).toBe(2);
  });

  it('пипетка в заливку есть и на iPhone: долгое нажатие на клавишу пипетки', () => {
    // Safari на iOS не шлёт contextmenu, и заливку пипеткой пальцем было не взять.
    expect(palette).toMatch(/function pipetteHold\(/);
    expect(palette).toMatch(/onpointerdown=\{pipetteHold\}/);
    // Отпускание после удержания — не второе нажатие, клавиша — всегда нажатие.
    expect(palette).toMatch(/held && e\.detail !== 0/);
  });

  it('палитра из черновика или хранилища не больше самой большой сетки', () => {
    // Файл черновика — откуда угодно: 100 000 цветов — 100 000 кнопок.
    const many = Array.from({ length: 5000 }, (_, i) => '#' + i.toString(16).padStart(6, '0'));
    expect(paletteFromStore(many).length).toBe(SAVED_PALETTE_MAX);
    expect(paletteFromStore(['#aaaaaa', '#aaaaaa', '#bbbbbb'])).toEqual(['#aaaaaa', '#bbbbbb']);
    expect(fn(colours, 'loadPalette')).toContain('paletteFromStore(raw)');
  });

  it('палитра, которую хранилище не приняло, не пропадает молча', () => {
    expect(state).toMatch(/saveCurrentPalette\(name: string\): boolean/);
    expect(fn(palette, 'savePalette')).toMatch(/!editor\.saveCurrentPalette\(name\)[\s\S]*palette\.not_stored/);
    expect(ru.palette.not_stored).toBeString();
  });

  it('не-цвет от пипетки браузера или откуда ещё не уходит в кисть', () => {
    // sRGBHex — ответ браузера; «red» или rgb() в кисти — штрих не проходит схему.
    expect(state).toMatch(/pickColor\(color: string[\s\S]*?parseColourInput\(color\)[\s\S]*if \(!hex\) return;/);
  });

  it('быстрая палитра плагина приводится к виду сетки', () => {
    // Заглавные никогда не читались выбранными, «red» уходил в кисть, повтор ронял keyed each.
    expect(quickColours(['#FF0000', '#f00', 'red', '#000000'])).toEqual(['#ff0000', '#000000']);
    expect(panel).toMatch(/quickColours\(editor\.ux\.quickPalette\)/);
  });

  it('под мега-ластиком цвет не читается выбранным', () => {
    expect(panel).toMatch(/editor\.tool === 'mega-eraser'/);
    expect(panel).not.toMatch(/editor\.tool !== 'eraser'/);
  });

  it('нажатая клавиша подвала видна и в Safari 16.0–16.1, где нет color-mix()', () => {
    expect(palette).toMatch(/@supports not \(color: color-mix\(in srgb, red, red\)\) \{\s*\.foot-btn\.active \{\s*background: var\(--sub\);/);
  });
});
