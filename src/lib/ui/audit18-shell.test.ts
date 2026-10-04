import { describe, expect, it } from 'bun:test';
import { withoutLetterKeys } from './key-owner';
import { itemDrawn, type PanelLayout } from './panels';

// Восемнадцатый аудит, оболочка студии. Editor.svelte проверяется как исходник,
// как в audit17-shell.test.ts; что можно запустить по-настоящему — запускается.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

function fn(name: string): string {
  const match = editorUi.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

const layout = (patch: Partial<PanelLayout>): PanelLayout => ({ left: [], right: [], rows: [], float: [], hidden: [], ...patch });
const open = { left: false, right: false, rows: false };

describe('Пробел при свёрнутой панели', () => {
  it('транспорт нарисован, пока его панель развёрнута, и в окне — всегда', () => {
    expect(itemDrawn(layout({ rows: [['fps', 'transport'], ['timeline']] }), 'transport', open)).toBe(true);
    expect(itemDrawn(layout({ left: ['transport'] }), 'transport', open)).toBe(true);
    expect(itemDrawn(layout({ right: ['transport'] }), 'transport', open)).toBe(true);
    expect(itemDrawn(layout({ float: ['transport'] }), 'transport', { left: true, right: true, rows: true })).toBe(true);
  });

  it('не нарисован в свёрнутой панели, свёрнутой колонке и на полке: там Пробел ничего не нажимал', () => {
    expect(itemDrawn(layout({ rows: [['transport']] }), 'transport', { ...open, rows: true })).toBe(false);
    expect(itemDrawn(layout({ left: ['transport'] }), 'transport', { ...open, left: true })).toBe(false);
    expect(itemDrawn(layout({ right: ['transport'] }), 'transport', { ...open, right: true })).toBe(false);
    expect(itemDrawn(layout({ hidden: ['transport'] }), 'transport', open)).toBe(false);
  });

  it('тогда у клавиши есть свой невидимый проигрыватель — как лист экспорта у Alt+S', () => {
    expect(editorUi).toMatch(/const transportDrawn = \$derived\(\s*compact \|\| itemDrawn\(editor\.panels, 'transport', \{ left: folded\('left'\), right: folded\('right'\), rows: panelFolded \}\)/);
    expect(editorUi).toMatch(/\{#if !transportDrawn\}\s*<div hidden><PlayControls bind:this=\{playControls\} \{editor\} \/><\/div>\s*\{\/if\}/);
  });
});

describe('фокус с кнопки, которая выключилась', () => {
  it('передаётся и тогда, когда Chrome уже уронил его на <body>: кадр мог нарисоваться раньше таймера', () => {
    const pass = fn('passFocusOnDisable');
    // Held at the press — Safari's mouse click focuses no button, and there is nothing to pass.
    expect(pass).toMatch(/const held = document\.activeElement === key;[^]*await new Promise/);
    expect(pass).toMatch(/!held \|\| !key\.disabled/);
    expect(pass).toMatch(/at !== key && at !== document\.body/);
  });
});

describe('состояние «не сохранено»', () => {
  it('метка слоя — правка: после записи смена цвета снова зажигает «Сохранить», иначе она уходила вместе с вкладкой', () => {
    const from = editorUi.indexOf('if (!editor.touched) {\n      return;\n    }\n    // The document is one value');
    expect(from).toBeGreaterThan(0);
    const effect = editorUi.slice(from, editorUi.indexOf('});', from));
    // Read before the comparison: behind `||` a changed document left the tags unsubscribed.
    expect(effect).toMatch(/const tags = editor\.layerColors\.join\(\);\s*if \(editor\.doc !== writtenDoc \|\| tags !== writtenTags\) \{\s*dirty = true;/);
    expect(fn('saveNow')).toMatch(/writtenDoc = doc;\s*writtenTags = editor\.layerColors\.join\(\);/);
  });
});

describe('«Добавить кадр» перед текущим', () => {
  it('Cmd+нажатие тоже: на Mac Ctrl+нажатие — контекстное меню, до кнопки оно не доходит', () => {
    expect(fn('onAddFrame')).toMatch(/e\.ctrlKey \|\| e\.metaKey/);
  });
});

describe('справка', () => {
  it('называет F7: без буквенных клавиш строка «Добавить кадр» пропадала, хотя F7 работает', () => {
    expect(editorUi).toContain("['A, F7', t('key.add_frame')]");
    expect(withoutLetterKeys('A, F7')).toBe('F7');
  });
});
