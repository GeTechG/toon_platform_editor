// Eighteenth audit, colour area: what a pick does to the tool in hand under
// «белый — ластик», the pipette a draft brings back, and the colour field's
// Enter. Runes components and the runes state class are asserted as source.
import { describe, expect, it } from 'bun:test';
import { toolAfterColorChange, type UxProfile } from './ux-profile';

const read = (name: string) => Bun.file(new URL(name, import.meta.url)).text();
const picker = await read('./ColourPicker.svelte');
const state = await read('./editor-state.svelte.ts');

const method = (name: string) =>
  state.match(new RegExp(`\\n  (private )?${name}\\([^]*?\\n  \\}`))?.[0] ?? '';

describe('восемнадцатый аудит: цвет', () => {
  it('пипетка удержанием под Мультатором не отбирает ластик: цвет идёт мимо правила «цвет — карандаш»', () => {
    // keepTool пропускал только «ластик → карандаш» самого pickColor, а
    // setBrushColor следом всё равно давал карандаш под whiteIsEraser.
    const pick = method('pickColor');
    expect(pick).toMatch(/else if \(keepTool\) \{[^}]*this\.brushColor = hex;\s*this\.keepColourRules\(\);\s*\}/);
    // Карандаш с белым и тут становится ластиком — правило держит keepColourRules.
    expect(method('keepColourRules')).toMatch(/this\.tool === 'pencil'/);
  });

  it('цвет заливки, выбранный с ластиком в руке, не даёт белый карандаш под Мультатором', () => {
    // Контур белый (ластик), выбрана заливка: ластик уступал карандашу
    // безусловно, а контур не менялся — карандаш рисовал белым.
    const pick = method('pickColor');
    expect(pick).toContain("this.hold(toolAfterColorChange(this.brushColor, this.ux) ?? 'pencil')");
    expect(pick).not.toContain("this.hold('pencil')");
    const multator = { whiteIsEraser: true } as UxProfile;
    expect(toolAfterColorChange('#ffffff', multator)).toBe('eraser');
    expect(toolAfterColorChange('#ff0000', multator)).toBe('pencil');
    expect(toolAfterColorChange('#ffffff', { whiteIsEraser: false } as UxProfile)).toBeNull();
  });

  it('черновик, записанный с пипеткой в руке, не открывает экранную пипетку браузера', () => {
    // selectTool берёт пипетку заново — с EyeDropper поверх только что
    // открытого черновика; restoreTool кладёт инструмент как был.
    const restore = method('restoreState');
    expect(restore).toContain('this.restoreTool(saved.tool as Tool)');
    expect(restore).not.toContain('this.selectTool(');
    expect(method('restoreTool')).not.toContain('openBrowserPicker');
  });

  it('Enter на нечитаемом тексте в поле цвета не закрывает окно молча', () => {
    // «#ff88» + Enter: окно закрывалось со старым цветом, будто приняло.
    expect(picker).toMatch(/function commitHex\(\): boolean \{/);
    const key = picker.match(/function onKeydown[^]*?\n  \}/)?.[0] ?? '';
    expect(key).toContain("const ok = action !== 'commit' || commitHex();");
    expect(key).toContain('else if (ok) requestClose();');
    expect(key).not.toMatch(/else requestClose\(\);/);
    // Событие всё равно гасится: Enter не должен дойти до студии.
    expect(key).toMatch(/commitHex\(\);\s*e\.stopPropagation\(\);\s*e\.preventDefault\(\);/);
  });

  it('«исходный» в окне цвета под пальцем — в рост клавиши', () => {
    expect(picker).toMatch(/@media \(pointer: coarse\) \{\s*\.preview \{\s*min-height: var\(--key-h\);/);
  });
});
