import { describe, expect, it } from 'bun:test';
import { parseColourInput, rgbToHex } from './color-model';
import { pickerKeyAction } from './picker-model';
import { SAVED_PALETTE_MAX, gridScrollDelta, parseSavedPalettes, withUniqueIds, type SavedPalette } from './color-palette';
import { PALETTE_LIMIT_MAX } from './presets';

const read = (name: string) => Bun.file(new URL(name, import.meta.url)).text();
const picker = await read('./ColourPicker.svelte');
const palette = await read('./PaletteBox.svelte');

const fn = (source: string, name: string) => source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n  \\}`))?.[0] ?? '';

describe('четырнадцатый аудит: цвет', () => {
  it('бесконечный оттенок в hsl() не красит кисть в «#NaNNaNNaN»', () => {
    // 1e999 читается как Infinity, Infinity % 360 — NaN, и NaN уходил в hex:
    // штрих с таким цветом не проходит схему документа.
    expect(parseColourInput('hsl(1e999 50% 50%)')).toBeNull();
    expect(parseColourInput('hsl(1e999, 50%, 50%)')).toBeNull();
    expect(rgbToHex({ r: Number.NaN, g: 0, b: 0 })).toMatch(/^#[0-9a-f]{6}$/);
    // Большие, но конечные числа по-прежнему упираются в край канала.
    expect(parseColourInput('rgb(1e5 0 0)')).toBe('#ff0000');
  });

  it('currentcolor — не цвет: окно не красит его в чёрный', () => {
    // Холст отвечает на currentcolor чёрным, какой бы цвет ни был вокруг.
    expect(parseColourInput('currentcolor', () => '#000000')).toBeNull();
    expect(parseColourInput('CurrentColor', () => '#000000')).toBeNull();
    expect(parseColourInput('red', (n) => (n === 'red' ? '#ff0000' : null))).toBe('#ff0000');
  });

  it('Esc в окне цвета — его собственный: окно-вкладка на телефоне не закрывается вместе с ним', () => {
    // Keydown Esc всплывал до #tab-window, тот гасил его default и закрывал
    // вкладку: пикер пропадал без отката, cancel у диалога так и не наступал.
    expect(pickerKeyAction('Escape', 'CANVAS')).toBe('revert');
    expect(pickerKeyAction('Escape', 'INPUT')).toBe('revert');
    expect(pickerKeyAction('Escape', 'BUTTON')).toBe('revert');
    const keydown = fn(picker, 'onKeydown');
    expect(keydown).toMatch(/action === 'revert'[\s\S]*requestClose\(\{ revert: true \}\)/);
    expect(keydown).toContain('e.stopPropagation()');
  });

  it('набор через IME: Enter и Esc, закрывающие композицию, окно не трогают', () => {
    expect(fn(picker, 'onKeydown')).toMatch(/e\.isComposing[\s\S]*?return/);
  });

  it('отмена по Esc без перемен ничего не трогает, а после перемен возвращает и инструмент', () => {
    // Открыл окно на ластике, передумал — и уже с карандашом: pickColor
    // всегда уводит ластик, даже когда цвет возвращается тот же.
    expect(palette).toMatch(/picking = \{[\s\S]*?tool: editor\.tool/);
    const close = fn(palette, 'closePicker');
    expect(close).toMatch(/revert[\s\S]*current !== origin[\s\S]*pickColor\(origin/);
    expect(close).toMatch(/editor\.tool !== tool[\s\S]*selectTool\(tool\)/);
  });

  it('повторное нажатие на выбранную модель не сбрасывает оттенок серого', () => {
    // colorToPointer для серого даёт оттенок 0: полоса прыгала на красный.
    expect(fn(picker, 'setModel')).toMatch(/if \(next === model\) return;/);
  });

  it('поле и полоса ведутся одним указателем: второй палец не дёргает цвет', () => {
    expect(fn(picker, 'drag')).toMatch(/active !== null[\s\S]*return/);
    expect(fn(picker, 'move')).toMatch(/e\.pointerId !== active/);
    expect(picker).toMatch(/onlostpointercapture=\{release\}/);
  });

  it('фокус на поле при нажатии не прокручивает окно под пальцем', () => {
    expect(fn(picker, 'drag')).toContain('el.focus({ preventScroll: true })');
  });

  it('сохранённые палитры из хранилища с повторным или чужим id не роняют список', () => {
    // Список ключуется по id, а «По умолчанию» — это id -1: повтор — each_key_duplicate.
    const list: SavedPalette[] = [
      { id: 1, name: 'a', created: 0, colours: [] },
      { id: 1, name: 'b', created: 0, colours: [] },
      { id: -1, name: 'c', created: 0, colours: [] },
      { id: 2.5, name: 'd', created: 0, colours: [] },
      { id: 7, name: 'e', created: 0, colours: [] },
    ];
    const ids = withUniqueIds(list).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => Number.isSafeInteger(id) && id >= 0)).toBe(true);
    // Годные id остаются как были: на них ссылаются открытые превью.
    expect(ids[0]).toBe(1);
    expect(ids[4]).toBe(7);
    expect(withUniqueIds(list).map((p) => p.name)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('сетка сама прокручивается к контуру, не двигая рейку и окно-вкладку', () => {
    // scrollIntoView двигал и всех прокручиваемых предков.
    expect(gridScrollDelta(100, 200, 120, 150)).toBe(0);
    expect(gridScrollDelta(100, 200, 80, 112)).toBe(-20);
    expect(gridScrollDelta(100, 200, 190, 222)).toBe(22);
    expect(palette).not.toContain('scrollIntoView(');
    expect(palette).toContain('gridScrollDelta(');
  });

  it('другая палитра в превью начинает Tab с первого цвета', () => {
    expect(palette).toMatch(/previewRove = 0/);
    expect(fn(palette, 'openPreview')).toContain('previewRove = 0');
  });

  it('долгое нажатие пальцем берёт заливку и там, где contextmenu не приходит (Safari на iOS)', () => {
    expect(palette).toMatch(/const HOLD_MS = \d+/);
    expect(palette).toMatch(/function holdStart\(/);
    // Обе сетки заводят таймер одним слушателем на сетку.
    expect(palette.match(/onpointerdown=\{\(e\) => holdStart\(/g)?.length).toBe(2);
    // Android шлёт и contextmenu: одно нажатие — одна заливка.
    expect(fn(palette, 'longPress')).toMatch(/if \(held\)/);
    expect(palette).toMatch(/-webkit-touch-callout: none/);
  });

  it('указатель, чей холст пропал посреди перетаскивания, не запирает поле', () => {
    // Смена модели убирает полосу вместе с захватом: lostpointercapture уходит
    // в документ, и без отпускания на окне поле больше не слушалось.
    expect(picker).toMatch(/<svelte:window[^>]*onpointerup=\{release\}[^>]*onpointercancel=\{release\}/);
  });

  it('палитра из чужого файла не больше самой большой сетки', () => {
    // 100 000 цветов в palettes.json — 100 000 кнопок в превью и замершая вкладка.
    expect(SAVED_PALETTE_MAX).toBe(PALETTE_LIMIT_MAX);
    const colours = Array.from({ length: 5000 }, (_, i) => '#' + i.toString(16).padStart(6, '0'));
    const [p] = parseSavedPalettes(JSON.stringify([{ id: 0, colours }]));
    expect(p.colours.length).toBe(SAVED_PALETTE_MAX);
    expect(p.colours[0]).toBe('#000000');
  });
});
