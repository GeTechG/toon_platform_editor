// Sixteenth audit, colour area: the colour window, the palette box and its
// saved palettes, the plain colour widget, the browser's eyedropper and the
// swap of outline and fill. Runes components and the runes state class are
// asserted as source; the palette maths is exercised for real.
import { describe, expect, it } from 'bun:test';
import { parseSavedPalettes } from './color-palette';

const read = (name: string) => Bun.file(new URL(name, import.meta.url)).text();
const picker = await read('./ColourPicker.svelte');
const panel = await read('./ColorPanel.svelte');
const state = await read('./editor-state.svelte.ts');
const ru = await Bun.file(new URL('../i18n/ru.json', import.meta.url)).json();

const method = (source: string, name: string) =>
  source.match(new RegExp(`\\n  (private )?${name}\\([^]*?\\n  \\}`))?.[0] ?? '';
const fn = (source: string, name: string) => source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n  \\}`))?.[0] ?? '';

describe('шестнадцатый аудит: цвет', () => {
  it('окно цвета не трогает инструмент, пока цвет не изменился', () => {
    // Enter в нетронутом поле, «исходный» при исходном цвете, то же число в
    // поле канала — всё это «выбирало» тот же цвет, и ластик уходил в карандаш.
    expect(fn(picker, 'pick')).toMatch(/if \(hex !== color\) onpick\(hex\)/);
    const script = picker.slice(0, picker.indexOf('</script>'));
    // onpick зовёт только pick; всё остальное идёт через него.
    expect(script.match(/\bonpick\(/g)?.length).toBe(1);
    expect(picker).toMatch(/onclick=\{\(\) => pick\(origin\)\}/);
  });

  it('обмен контура и заливки под Мультатором проходит правило «белый — ластик»', () => {
    // Белая заливка, ставшая контуром, рисовала белым карандашом — цвет,
    // который во всех остальных путях вооружает ластик.
    const swap = method(state, 'swapColors');
    expect(swap).toMatch(/this\.setBrushColor\(/);
    expect(swap).not.toMatch(/this\.brushColor = this\.fillColor/);
  });

  it('цвет из пипетки браузера возвращает инструмент, как в эталоне', () => {
    // Reference Picker.Selected → ResetPicker → ResetHelpTool: после взятого
    // цвета следующий клик по листу рисовал бы, а не брал цвет снова.
    const open = method(state, 'openBrowserPicker');
    expect(open).toMatch(/const target = this\.pipetteTarget/);
    expect(open).toMatch(/this\.pickColor\(result\.sRGBHex, target\);\s*if \(this\.tool === 'pipette'\) this\.resetHelpTool\(\);/);
  });

  it('сохранённая палитра из файла не держит один цвет дважды', () => {
    // #fff и #FFFFFF — один цвет: превью показывало два, счёт на плитке врал.
    const [p] = parseSavedPalettes(JSON.stringify([{ id: 1, name: 'a', colours: ['#fff', '#FFFFFF', '#000000'] }]));
    expect(p.colours).toEqual(['#ffffff', '#000000']);
  });

  it('подсказка контура говорит про M только там, где M прячет палитру', () => {
    // Без быстрой палитры M — «объединить», а подсказка обещала «скрыть палитру».
    expect(panel).toMatch(/editor\.ux\.quickPalette \? editor\.keyHint\(t\('color\.stroke_title'\)\) : t\('color\.stroke'\)/);
    expect(panel).toMatch(/aria-label=\{strokeTitle\}/);
    expect(ru.color.stroke).toBe('Цвет контура');
  });
});
