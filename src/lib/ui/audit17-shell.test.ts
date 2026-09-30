import { describe, expect, it } from 'bun:test';
import { withoutLetterKeys } from './key-owner';

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
    expect(merge).toMatch(/data-key=\{quickPalette \? undefined :/);
    expect(merge).toMatch(/quickPalette \? withoutLetterKeys\(t\('editor\.merge_title'\)\)/);
    expect(withoutLetterKeys(ru.editor.merge_title)).not.toMatch(/\(M\)/);
  });
});

describe('клавиши кнопок для экранного чтеца', () => {
  it('у каждой кнопки с подсказкой клавиши есть aria-keyshortcuts, как у «Отменить»', () => {
    expect(item('save')).toMatch(/aria-keyshortcuts="Control\+S"/);
    expect(item('copy')).toMatch(/aria-keyshortcuts=\{editor\.settings\.letterKeys \? 'C Control\+C' : 'Control\+C'\}/);
    expect(item('paste')).toMatch(/aria-keyshortcuts=\{editor\.settings\.letterKeys \? 'V Control\+V' : 'Control\+V'\}/);
    expect(item('merge')).toMatch(/aria-keyshortcuts=\{quickPalette \? undefined : editor\.settings\.letterKeys \? 'M Control\+M' : 'Control\+M'\}/);
    expect(item('add-frame')).toMatch(/aria-keyshortcuts=\{editor\.settings\.letterKeys \? 'A F7' : 'F7'\}/);
    expect(item('onion')).toMatch(/aria-keyshortcuts=\{editor\.settings\.letterKeys \? 'K' : undefined\}/);
    expect(item('export')).toMatch(/aria-keyshortcuts=\{hasProjectFile \? undefined : 'Alt\+S'\}/);
    expect(item('fullscreen')).toMatch(/aria-keyshortcuts=\{hasFeather \|\| !editor\.settings\.letterKeys \? undefined : 'F'\}/);
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
    const table = editorUi.slice(editorUi.indexOf('const SHORTCUTS'), editorUi.indexOf('// Copy/paste confirmation'));
    expect(table).toMatch(/has\('drag'\) && \['\+ \/ −, ←→↑↓', t\('key\.hand_keys'\)\]/);
    expect(typeof ru.key.hand_keys).toBe('string');
  });

  it('без однобуквенных клавиш остаются стрелки: + и − тогда не работают', () => {
    expect(withoutLetterKeys('+ / −, ←→↑↓')).toBe('←→↑↓');
  });
});
