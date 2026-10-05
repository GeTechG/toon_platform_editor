import { describe, expect, it } from 'bun:test';
import { t } from '../i18n';
import { twinSelector } from './focus-heir';
import { compactLayout, railDrawn } from './small-screen';

// Owner after the seventeenth audit: nothing small is put off. Windows, small
// screens and the system. The Svelte glue is checked by its source (as in
// audit17-*); the pure parts are run for real.
const UI = new URL('./', import.meta.url).pathname;
const editorSvelte = await Bun.file(UI + 'Editor.svelte').text();
const floatWindow = await Bun.file(UI + 'FloatWindow.svelte').text();
const arranger = await Bun.file(UI + 'PanelArranger.svelte').text();
const paletteBox = await Bun.file(UI + 'PaletteBox.svelte').text();
const state = await Bun.file(UI + 'editor-state.svelte.ts').text();

describe('окно зума и окно трансформации — в общем стеке окон', () => {
  it('нажатие или фокус поднимает окна инструментов над плавающими', () => {
    expect(state).toMatch(/toolsOnTop = \$state\(false\)/);
    const tools = editorSvelte.slice(editorSvelte.indexOf('<div class="tool-windows"'), editorSvelte.indexOf('<TransformMenu'));
    expect(tools).toContain('onpointerdowncapture={raiseTools}');
    expect(tools).toContain('onfocusin={raiseTools}');
    const scale = editorSvelte.slice(editorSvelte.indexOf('<div class="scale-window"'), editorSvelte.indexOf('<ScaleMenu'));
    expect(scale).toContain('onpointerdowncapture={raiseTools}');
    expect(scale).toContain('onfocusin={raiseTools}');
    // Over the top window's rung, under the sheets.
    expect(editorSvelte).toContain("style:z-index={editor.toolsOnTop ? 'calc(var(--z-float) + 4)' : undefined}");
  });

  it('плавающее окно, поднятое нажатием, снова над ними, и верхние ступени сдвигаются', () => {
    const raise = floatWindow.slice(floatWindow.indexOf('function raise(): void {'));
    expect(raise.slice(0, raise.indexOf('\n  }\n'))).toContain('editor.toolsOnTop = false');
    expect(floatWindow).toContain('(editor.toolsOnTop ? 3 : 4)');
  });
});

describe('подсказка переноса — вместе с призраком', () => {
  it('на нажатии без движения остаётся «как переносить», а не «переносим»', () => {
    expect(arranger).toContain("{:else if drag?.moved}\n      {t('arrange.dragging', { label: dragLabel })}");
  });
});

describe('компакт → полный: фокус из окна вкладки не падает на body', () => {
  const el = (tag: string, attrs: Record<string, string>) => ({
    tagName: tag.toUpperCase(),
    getAttribute: (name: string) => attrs[name] ?? null,
  });

  it('тот же контрол находится по id, инструменту или имени', () => {
    expect(twinSelector(el('input', { id: 'fps' }))).toBe('input[id="fps"]');
    expect(twinSelector(el('button', { 'data-tool': 'pencil', 'aria-label': 'Карандаш' }))).toBe('button[data-tool="pencil"]');
    expect(twinSelector(el('button', { 'aria-label': 'Цвет «ку"ку»' }))).toBe('button[aria-label="Цвет «ку\\"ку»"]');
    expect(twinSelector(el('div', {}))).toBeNull();
  });

  it('Editor переносит фокус на двойника, иначе на наследника', () => {
    const pass = editorSvelte.slice(editorSvelte.indexOf('// The tab window goes with the small screen'));
    expect(pass).toContain('twinSelector(');
    expect(pass.slice(0, 1200)).toContain('$effect.pre(');
    expect(pass.slice(0, 1200)).toMatch(/usableKey/);
  });
});

describe('шаг планшета считает колонку, которая рисуется', () => {
  it('левая пуста, история в правой: на планшете она в колонке, и та рисуется', () => {
    const panels = { left: [], right: ['history'], top: [], rows: [], float: [], hidden: [] };
    const cut = compactLayout(panels, 'tablet', ['color', 'brush', 'timeline', 'sound', 'more']);
    expect(cut.rail).toEqual(['history']);
    expect(railDrawn(cut, false)).toBe(true);
  });

  it('пустая колонка без отправки не рисуется; с отправкой рисуется', () => {
    expect(railDrawn({ rail: [], foot: [], tabs: [] }, true)).toBe(false);
    expect(railDrawn({ rail: [], foot: ['publish'], tabs: [] }, false)).toBe(false);
    expect(railDrawn({ rail: [], foot: ['publish'], tabs: [] }, true)).toBe(true);
    expect(railDrawn({ rail: ['pencil'], foot: [], tabs: [] }, false)).toBe(true);
  });

  it('и разметка, и расчёт шага спрашивают одно и то же', () => {
    expect(editorSvelte).toContain('{#if railDrawn(cut, !!onPublish)}');
    const effect = editorSvelte.slice(editorSvelte.indexOf('const full = { w: boxW'), editorSvelte.indexOf('step = pickStep('));
    expect(effect).toContain("railDrawn(compactLayout(editor.panels, 'tablet', editor.settings.tabOrder), !!onPublish)");
    expect(effect).not.toContain('editor.panels.left.length ?');
  });
});

describe('система', () => {
  it('ячейка палитры растёт с текстом, под пальцем — до клавиши', () => {
    const from = paletteBox.indexOf('  .cell {');
    const cell = paletteBox.slice(from, paletteBox.indexOf('\n  }\n', from));
    expect(cell).toContain('height: 2rem;');
    expect(cell).not.toContain('32px');
    expect(paletteBox).toMatch(/@media \(pointer: coarse\) \{\s*\.grid \{\s*grid-template-columns: repeat\(auto-fill, minmax\(var\(--key-h, 2\.75rem\), 1fr\)\);\s*\}\s*\.cell \{\s*height: var\(--key-h, 2\.75rem\);/);
  });

  it('«из N чисел» склоняется', () => {
    expect(t('brush.broken_cubic', { count: 1 })).toContain('из 1 числа');
    expect(t('brush.broken_cubic', { count: 21 })).toContain('из 21 числа');
    expect(t('brush.broken_cubic', { count: 3 })).toContain('из 3 чисел');
    expect(t('brush.broken_cubic', { count: 5 })).toContain('из 5 чисел');
  });
});
