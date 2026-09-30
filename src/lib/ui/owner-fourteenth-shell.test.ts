import { describe, expect, it } from 'bun:test';
import { addFrame, addLayer, addStroke, createDocument } from '../model/operations';
import { EMPTY_TRANSFORM } from '../tools/lasso';
import { bakeTransform } from '../tools/bake-transform';
import { keyOwner, repeats } from './key-owner';
import { frameMenuKey } from './frame-selection';
import { RESERVED_KEYS } from '../plugins/builtins';

// Ответы владельца после четырнадцатого аудита, оболочка студии.
// 1. Ctrl+S при сдвинутом и не применённом выделении сначала применяет его,
//    как публикация и экспорт; под замком трансформации — отказ с подсказкой.
// 2. Вкладка ушла в фон: черновик пишется со сдвигом, а живое выделение
//    у человека остаётся — пишется копия рисунка с применённой трансформацией.
// 3. Backspace — то же, что Delete: кадр, Shift — слой. Не в текстовых полях.
// 4. Alt+S открывает экспорт всегда, даже без ключа «Экспорт» на панелях.
const UI = new URL('./', import.meta.url).pathname;
const editorUi = await Bun.file(UI + 'Editor.svelte').text();
const state = await Bun.file(UI + 'editor-state.svelte.ts').text();
const layerRows = await Bun.file(UI + 'LayerRows.svelte').text();
const exportSheet = await Bun.file(UI + 'ExportSheet.svelte').text();
const ru = JSON.parse(await Bun.file(UI + '../i18n/ru.json').text());

function fn(name: string): string {
  const match = editorUi.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

function snippet(id: string): string {
  const at = editorUi.indexOf(`{:else if id === '${id}'}`);
  if (at < 0) throw new Error(`missing ${id}`);
  return editorUi.slice(at, editorUi.indexOf('{:else if', at + 10));
}

function drawn() {
  const doc = createDocument();
  addStroke(doc, 0, 0, { points: [10, 20, 30, 40], width: 9, color: '#000000' });
  addLayer(doc, 1);
  addStroke(doc, 1, 0, { points: [5, 5, 6, 6], width: 9, color: '#000000' });
  addFrame(doc, 0);
  addStroke(doc, 0, 1, { points: [1, 1, 2, 2], width: 9, color: '#000000' });
  return doc;
}

const box = { x: 10, y: 20, width: 20, height: 20 };

describe('Ctrl+S при живой трансформации', () => {
  const ctrlS = onKeydownBlock(/\(e\.ctrlKey \|\| e\.metaKey\) && \(key === 's' \|\| key === 'S'\)\) \{/);

  it('сначала применяет сдвиг, потом пишет: черновик получал рисунок без него', () => {
    const leave = ctrlS.indexOf('editor.leaveTransform()');
    expect(leave).toBeGreaterThan(-1);
    expect(leave).toBeLessThan(ctrlS.indexOf('saveNow(true)'));
  });

  it('под замком трансформации не пишет: leaveTransform сам говорит «выделение заперто»', () => {
    expect(ctrlS).toMatch(/if \(!e\.repeat && editor\.leaveTransform\(\)\) \{\s*saveNow\(true\);/);
    expect(state).toMatch(/if \(this\.transformLock\) \{\s*this\.canvasHint = \{ text: t\('canvas\.transform_locked'\) \};\s*return false;/);
  });
});

function onKeydownBlock(head: RegExp): string {
  const keys = fn('onKeydown');
  const at = keys.search(head);
  if (at < 0) throw new Error('missing block');
  return keys.slice(at, keys.indexOf('return;', at));
}

describe('рисунок с применённой трансформацией, не выходя из неё', () => {
  it('сдвигает выбранные ячейки активного кадра в копии', () => {
    const doc = drawn();
    const baked = bakeTransform(doc, 0, { layers: [0], box, session: { ...EMPTY_TRANSFORM, dx: 100, dy: -5 }, widthWithScale: false });
    expect(baked).not.toBe(doc);
    expect(baked.layers[0].frames[0].strokes[0].points).toEqual([110, 15, 130, 35]);
  });

  it('не трогает сам рисунок: живое выделение продолжает двигать неприменённое', () => {
    const doc = drawn();
    const before = JSON.stringify(doc);
    const layers = doc.layers;
    const tools = doc.tools;
    bakeTransform(doc, 0, { layers: [0], box, session: { ...EMPTY_TRANSFORM, dx: 100, scaleX: 2, scaleY: 2 }, widthWithScale: true });
    expect(JSON.stringify(doc)).toBe(before);
    expect(doc.layers).toBe(layers);
    expect(doc.tools).toBe(tools);
  });

  it('прочие слои и кадры — те же объекты, копируется только то, что двигалось', () => {
    const doc = drawn();
    const baked = bakeTransform(doc, 0, { layers: [0], box, session: { ...EMPTY_TRANSFORM, dx: 1 }, widthWithScale: false });
    expect(baked.layers[1]).toBe(doc.layers[1]);
    expect(baked.layers[0].frames[1]).toBe(doc.layers[0].frames[1]);
  });

  it('толщина с масштабом ложится новым инструментом копии', () => {
    const doc = drawn();
    const baked = bakeTransform(doc, 0, { layers: [0], box, session: { ...EMPTY_TRANSFORM, scaleX: 2, scaleY: 2 }, widthWithScale: true });
    const tool = baked.tools[baked.layers[0].frames[0].strokes[0].tool_id];
    expect('width' in tool && tool.width).toBe(18);
    expect(doc.tools.length).toBe(1);
  });

  it('несдвинутое выделение — тот же рисунок, писать нечего', () => {
    const doc = drawn();
    expect(bakeTransform(doc, 0, { layers: [0], box, session: { ...EMPTY_TRANSFORM }, widthWithScale: false })).toBe(doc);
  });

  it('состояние отдаёт его, пока трансформация открыта, и сам рисунок без неё', () => {
    const body = state.match(/\n  docWithTransform\(\): ToonDocument \{[^]*?\n  }/)?.[0] ?? '';
    expect(body).toMatch(/bakeTransform\(this\.doc, this\.activeFrame, open\)/);
    // Так же, как commitTransform: в превью и в запертых слоях ничего не пишется.
    expect(body).toMatch(/this\.playing \|\| !this\.mayEdit\(open\.layers\)/);
  });
});

describe('вкладка ушла в фон с живым выделением', () => {
  it('пишет черновик со сдвигом, не выходя из трансформации', () => {
    const hide = editorUi.match(/onvisibilitychange=\{[^}]*\}/)?.[0] ?? '';
    expect(hide).toMatch(/flushOnHide\(\)/);
    const body = fn('flushOnHide');
    expect(body).not.toMatch(/leaveTransform/);
    expect(body).toMatch(/const shown = editor\.docWithTransform\(\);/);
    expect(body).toMatch(/if \(shown !== editor\.doc\) \{\s*void saveNow\(false, true, shown\);/);
    expect(body).toMatch(/flushOnLeave\(\)/);
  });

  it('saveNow пишет переданный рисунок, а не только editor.doc', () => {
    const save = fn('saveNow');
    expect(save).toMatch(/function saveNow\(byHand = false, leaving = false, shown\?: ToonDocument\)/);
    expect(save).toMatch(/const doc = shown \?\? editor\.doc;/);
  });
});

describe('Backspace — синоним Delete', () => {
  it('в таблице клавиш удаляет кадр, с Shift — слой, как Delete', () => {
    const keys = fn('onKeydown');
    expect(keys).toMatch(/case 'Delete':\s*case 'Backspace':\s*[^]*?if \(e\.shiftKey\) \{\s*editor\.removeActiveLayer\(\);\s*\} else \{\s*editor\.removeActiveFrame\(\);/);
  });

  it('в поле имени слоя и в любом текстовом поле стирает букву, а не кадр', () => {
    const input = { tagName: 'INPUT', isContentEditable: false, getAttribute: (n: string) => (n === 'type' ? 'text' : null), matches: () => false };
    const press = { target: input, defaultPrevented: false, ctrlKey: false, metaKey: false, modalOpen: false, letterKeys: true };
    expect(keyOwner({ ...press, key: 'Backspace' })).toBe('control');
    expect(keyOwner({ ...press, key: 'Backspace', target: null })).toBe('editor');
  });

  it('держится, как Delete: кадр за кадром', () => {
    expect(repeats('Backspace')).toBe(true);
  });

  it('плагин не может его себе забрать', () => {
    expect(RESERVED_KEYS).toContain('Backspace');
  });

  it('строка слоя удаляет слой и по Backspace', () => {
    expect(layerRows).toMatch(/if \(e\.key === 'Delete' \|\| e\.key === 'Backspace'\) \{/);
    expect(layerRows).toMatch(/aria-keyshortcuts="Delete Backspace"/);
  });

  it('меню кадра, ключ «Удалить кадр», подсказка и мануал называют обе клавиши', () => {
    expect(frameMenuKey('delete', true, false)).toEqual({ aria: 'Delete Backspace', label: 'Del' });
    expect(snippet('delete-frame')).toMatch(/aria-keyshortcuts="Delete Backspace"/);
    expect(ru.editor.delete_frame_title).toContain('Backspace');
    expect(editorUi).toMatch(/\['Del \/ Backspace', t\('key\.delete_frame'\)\]/);
  });
});

describe('Alt+S открывает экспорт и без ключа на панелях', () => {
  it('лист экспорта один и стоит вне ключей: убранный из раскладки ключ не уносит его', () => {
    expect(editorUi.match(/^\s*<ExportSheet\b/gm)?.length).toBe(1);
    const panelItem = editorUi.slice(editorUi.indexOf('{#snippet panelItem('), editorUi.indexOf('{/snippet}', editorUi.indexOf('{#snippet panelItem(')));
    expect(panelItem).not.toMatch(/<ExportSheet\b/);
  });

  it('ключ — только кнопка, что открывает этот лист; вкладка «Ещё» не открывается', () => {
    const key = snippet('export');
    expect(key).toMatch(/onclick=\{\(\) => exportButton\?\.start\(\)\}/);
    // Под Toonio Alt+S скачивает проект — там ключ его не обещает (audit16-shell).
    expect(key).toMatch(/data-key=\{hasProjectFile \? undefined : 'Alt\+S'\}/);
    const alt = onKeydownBlock(/e\.altKey && \(key === 's' \|\| key === 'S'\)\) \{/);
    expect(alt).not.toMatch(/openTab|showTab/);
  });

  it('лист сам кнопки не рисует', () => {
    expect(exportSheet).not.toMatch(/<button\s+class="key"\s+onclick=\{openSheet\}/);
  });

  it('открытие по-прежнему применяет сдвиг и пишет черновик', () => {
    const at = editorUi.search(/\n\s*<ExportSheet\b/);
    const sheet = editorUi.slice(at, editorUi.indexOf('/>', at));
    expect(sheet).toMatch(/onOpen=\{\(\) => \{[^}]*editor\.leaveTransform\(\)[^}]*saveNow\(\)/);
  });
});
