import { describe, expect, it } from 'bun:test';
import { buildKeymap, chordAria, chordLabel, isBare, studioCommands } from './keymap';
import { manualSections, type ManualContext } from './manual-sections';
import { toolKeyList, toolOrder } from './panels';
import { withoutLetterKeys } from './key-owner';

const keys = buildKeymap(studioCommands(toolOrder().map((id) => ({ id, keys: toolKeyList(id) }))), {});
const manual = (patch: Partial<ManualContext> = {}) =>
  manualSections({
    input: 'cursor',
    tools: toolOrder().map((id) => ({ id, label: id })),
    quickPalette: false,
    hasProjectFile: false,
    fullscreen: true,
    toolOpensBrush: false,
    keysOf: (command) => keys.bindings(command).map(chordLabel),
    ...patch,
  });
const rowsOf = (section: string, patch: Partial<ManualContext> = {}) => manual(patch).find((one) => one.id === section)?.rows ?? [];
const idsOf = (section: string, patch: Partial<ManualContext> = {}) => rowsOf(section, patch).map((row) => row.id);


// Семнадцатый аудит, оболочка студии. Editor.svelte проверяется как исходник,
// как в audit16-shell.test.ts; что можно запустить по-настоящему — запускается.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const ru = await Bun.file(new URL('../i18n/ru.json', import.meta.url)).json();

function fn(name: string): string {
  const match = editorUi.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

/** The markup of one panel item, from its branch to the next. */
function item(id: string): string {
  const from = editorUi.indexOf(`{:else if id === '${id}'}`);
  if (from < 0) throw new Error(`missing item ${id}`);
  return editorUi.slice(from, editorUi.indexOf('{:else if id ===', from + 1));
}

describe('сохранение рукой при живой трансформации', () => {
  it('флаг «не сохранено» ставится, только если документ не тот, что записан: эффект после Ctrl+S снова зажигал «Сохранить» и вопрос вкладки', () => {
    const from = editorUi.indexOf('if (!editor.touched) {\n      return;\n    }\n    // The document is one value');
    expect(from).toBeGreaterThan(0);
    const effect = editorUi.slice(from, editorUi.indexOf('});', from));
    expect(effect).toMatch(/editor\.doc !== writtenDoc/);
  });

  it('кнопка «Сохранить» применяет сдвиг, как Ctrl+S: одна функция на двоих', () => {
    const save = fn('saveByHand');
    expect(save).toMatch(/editor\.leaveTransform\(\)/);
    expect(save).toMatch(/saveNow\(true\)/);
    expect(item('save')).toMatch(/onclick=\{saveByHand\}/);
    const keydown = fn('onKeydown');
    expect(keydown).toMatch(/!e\.repeat\) \{\n\s*saveByHand\(\)/);
  });

  it('кнопка не гаснет, пока сдвиг ещё не в документе: Ctrl+S его пишет, а кнопка молчала', () => {
    expect(item('save')).toMatch(/disabled=\{!dirty && !editor\.canUndoTransform\}/);
  });
});

describe('кнопка «Объединить» под Мультатором', () => {
  it('не обещает M: там M и Ctrl+M открывают палитру', () => {
    const merge = item('merge');
    // Through frameMenuKey, as the frame menu (owner-seventeenth-shell).
    expect(merge).toContain("data-key={menuKey('merge')?.label}");
    expect(merge).toContain("title={frameKeyTitle(t('editor.merge_title'), 'merge', editor.settings.letterKeys, quickPalette, menuKey('merge'))}");
    expect(withoutLetterKeys(ru.editor.merge_title)).not.toMatch(/\(M\)/);
  });
});

describe('клавиши кнопок для экранного чтеца', () => {
  it('у каждой кнопки с подсказкой клавиши есть aria-keyshortcuts, как у «Отменить»', () => {
    for (const id of ['save', 'copy', 'paste', 'onion', 'fullscreen']) {
      expect(item(id)).toContain(`aria-keyshortcuts={editor.keyAria('${id}')}`);
    }
    expect(item('merge')).toContain("aria-keyshortcuts={quickPalette ? undefined : editor.keyAria('merge')}");
    expect(item('add-frame')).toContain("aria-keyshortcuts={editor.keyAria('add-frame')}");
    expect(item('export')).toContain("aria-keyshortcuts={hasProjectFile ? undefined : editor.keyAria('export')}");
    // Что они объявляют: с буквами и без них.
    const aria = (command: string, letterKeys = true) =>
      keys.bindings(command).filter((chord) => letterKeys || !isBare(chord)).map(chordAria).join(' ');
    expect(aria('save')).toBe('Control+S');
    expect(aria('copy')).toBe('C Control+C');
    expect(aria('copy', false)).toBe('Control+C');
    expect(aria('paste')).toBe('V Control+V');
    expect(aria('paste', false)).toBe('Control+V');
    expect(aria('merge')).toBe('M Control+M');
    expect(aria('merge', false)).toBe('Control+M');
    expect(aria('add-frame')).toBe('A F7');
    expect(aria('add-frame', false)).toBe('F7');
    expect(aria('onion')).toBe('K');
    expect(aria('onion', false)).toBe('');
    expect(aria('export')).toBe('Alt+S');
    expect(aria('fullscreen')).toBe('F');
    expect(aria('fullscreen', false)).toBe('');
  });

  it('справка и черновики говорят, что откроют окно, как «Настройки»', () => {
    expect(item('manual')).toMatch(/aria-haspopup="dialog"/);
    expect(item('drafts')).toMatch(/aria-haspopup="dialog"/);
  });
});

describe('звук, брошенный после отказа', () => {
  it('убирает старую ошибку «файл не открыть»: звук-то открылся', () => {
    const drop = fn('onDrop');
    const audio = drop.slice(drop.indexOf('isAudioFile(file)'), drop.indexOf('} else {', drop.indexOf('isAudioFile(file)') + 40));
    expect(audio).toMatch(/importError = ''/);
  });
});

describe('справка про руку', () => {
  it('называет её клавиши: + / − масштаб листа, стрелки его двигают — без справки их не найти', () => {
    const row = (id: string) => rowsOf('sheet').find((one) => one.id === id);
    expect(row('hand_zoom')).toMatchObject({ kind: 'fixed', keys: '+ / −' });
    expect(row('hand_pan')).toMatchObject({ kind: 'fixed', keys: '← → ↑ ↓' });
    // Без руки этих строк нет: клавиши без неё делают другое.
    const noHand = idsOf('sheet', { tools: [{ id: 'pencil', label: 'Кисть' }] });
    expect(noHand).not.toContain('hand_zoom');
    expect(noHand).not.toContain('hand_pan');
  });

  it('без однобуквенных клавиш остаются стрелки: + и − тогда не работают', () => {
    expect(withoutLetterKeys('+ / −, ←→↑↓')).toBe('←→↑↓');
  });
});
