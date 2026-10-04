// Nineteenth audit, colour area: a drag that ends past the colour window is
// not a click outside it, and the grid follows an outline that joined it
// after it was chosen. Runes components are asserted as source.
import { describe, expect, it } from 'bun:test';

const read = (name: string) => Bun.file(new URL(name, import.meta.url)).text();
const picker = await read('./ColourPicker.svelte');
const box = await read('./PaletteBox.svelte');

describe('девятнадцатый аудит: цвет', () => {
  it('протяжка, отпущенная за краем окна цвета, окно не закрывает', () => {
    // Выделение текста в поле мышью с отпусканием за краем окна: click
    // приходит на общего предка нажатия и отпускания — сам dialog, с
    // координатами снаружи, и окно закрывалось посреди правки.
    const dialog = picker.match(/<dialog[^]*?\n>/)?.[0] ?? '';
    expect(dialog).toContain('onpointerdown={(e) => (pressedOutside = e.target === box && outside(e))}');
    expect(dialog).toContain('onclick={(e) => pressedOutside && e.target === box && outside(e) && requestClose()}');
    expect(dialog).not.toContain('onclick={(e) => e.target === box && outside(e) && requestClose()}');
  });

  it('сетка показывает контур, который попал в неё уже выбранным', () => {
    // «+» на большом образце и закрытие окна цвета кладут цвет в конец сетки
    // (или в ячейку кольца), а контур при этом не меняется: сетка стояла на
    // месте, и новая ячейка оставалась за краем прокрутки.
    const follow = box.match(/\$effect\(\(\) => \{\s*(?:\/\/[^\n]*\n\s*)*void outlineInGrid;[^]*?\n  \}\);/)?.[0] ?? '';
    expect(follow).toContain('gridScrollDelta(');
    expect(follow).toContain('editor.brushColor');
    // Не вся палитра: удаление чужой ячейки не должно дёргать сетку к контуру.
    expect(follow).not.toContain('editor.palette');
  });
});
