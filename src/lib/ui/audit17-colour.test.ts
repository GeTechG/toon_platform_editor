// Seventeenth audit, colour area: the quick pair, the plain colour widget,
// the swap, «белый — ластик» and the tool a colour hands over. Runes
// components and the runes state class are asserted as source.
import { describe, expect, it } from 'bun:test';

const read = (name: string) => Bun.file(new URL(name, import.meta.url)).text();
const panel = await read('./ColorPanel.svelte');
const state = await read('./editor-state.svelte.ts');

const method = (name: string) =>
  state.match(new RegExp(`\\n  (private )?${name}\\([^]*?\\n  \\}`))?.[0] ?? '';

describe('семнадцатый аудит: цвет', () => {
  it('цвет меняет инструмент через hold: окно плагина и живая трансформация уходят как положено', () => {
    // Под Мультатором цвет писал инструмент напрямую: инструмент плагина
    // оставался без deactivate и со своим окном, а живая трансформация лассо
    // продолжалась под карандашом.
    for (const name of ['setBrushColor', 'pickColor', 'swapColors', 'togglePalette']) {
      expect(method(name)).not.toMatch(/this\.tool = /);
    }
    expect(method('setBrushColor')).toMatch(/tool !== this\.tool && this\.leaveTransform\(\)\) \{?\s*this\.hold\(tool\)/);
  });

  it('M, убирающая палитру вместе с пипеткой, помнит «белый — ластик»', () => {
    // Белый контур и пипетка под Мультатором: M давала белый карандаш.
    expect(method('togglePalette')).toContain('this.keepColourRules()');
    expect(method('keepColourRules')).toMatch(/this\.hold\(toolAfterColorChange\(this\.brushColor, this\.ux\) \?\? 'pencil'\)/);
  });

  it('пресет приносит свои правила цвета: пипетка без палитры и белый карандаш уходят', () => {
    const preset = method('applyPreset');
    expect(preset).toMatch(/this\.paletteExpanded = this\.ux\.quickPalette === null;\s*this\.keepColourRules\(\);/);
    const rules = method('keepColourRules');
    expect(rules).toContain("this.tool === 'pipette' && this.ux.pipetteNeedsPalette && !this.paletteExpanded");
    expect(rules).toContain('toolAfterColorChange(this.brushColor, this.ux)');
    expect(method('togglePalette')).toContain('this.keepColourRules()');
  });

  it('быстрая пара выбирает цвет как любой другой путь: ластик уступает карандашу', () => {
    // setBrushColor оставлял ластик в руке под пресетом плагина с быстрой
    // парой, но без «белый — ластик»: цвет выбран, а рисует ластик.
    const quick = panel.match(/<div class="quick"[^]*?<\/div>/)?.[0] ?? '';
    expect(quick).toContain("onclick={() => editor.pickColor(color, 'outline', true)}");
    expect(quick).not.toContain('setBrushColor');
  });

  it('цвет из системного окна простого виджета ложится в палитру по настройке', () => {
    // «Добавлять выбранный цвет в палитру» работал в окне цвета палитры,
    // но не в системном окне простого виджета.
    expect(panel).toContain("onchange={(e) => editor.pickColor(e.currentTarget.value, 'outline')}");
    expect(panel).toContain("onchange={(e) => editor.pickColor(e.currentTarget.value, 'fill')}");
  });
});
