import { describe, expect, it } from 'bun:test';
import { frameKeyTitle } from './frame-selection';

// Ответы владельца после семнадцатого аудита, оболочка и настройки. Разметка
// .svelte проверяется исходником, как в audit17-shell.test.ts; чистая логика
// выполняется по-настоящему.
const read = (name: string) => Bun.file(new URL(`./${name}`, import.meta.url)).text();
const editorUi = await read('Editor.svelte');
const settingsUi = await read('SettingsSheet.svelte');
const transformUi = await read('TransformMenu.svelte');
const ru = await Bun.file(new URL('../i18n/ru.json', import.meta.url)).json();

/** The markup of one panel item, from its branch to the next. */
function item(id: string): string {
  const from = editorUi.indexOf(`{:else if id === '${id}'}`);
  if (from < 0) throw new Error(`missing item ${id}`);
  return editorUi.slice(from, editorUi.indexOf('{:else if id ===', from + 1));
}

describe('журнал ошибок из «Настроек»', () => {
  it('кнопка рядом с «Сохранить сейчас» скачивает тот же файл, что Alt+L: одна функция на двоих', () => {
    const save = settingsUi.indexOf("t('settings.save_now')");
    const errors = settingsUi.indexOf("t('settings.download_errors')");
    expect(errors).toBeGreaterThan(save);
    expect(errors - save).toBeLessThan(400);
    expect(settingsUi).toMatch(/onDownloadErrors\?: \(\) => void/);
    expect(editorUi).toMatch(/onDownloadErrors=\{downloadErrorLog\}/);
    expect(editorUi.match(/toonop-errors\.txt/g)).toHaveLength(1);
    expect(ru.settings.download_errors).toBe('Скачать журнал ошибок (Alt+L)');
  });
});

describe('кнопки оболочки без однобуквенных клавиш', () => {
  it('подсказка называет то же, что меню кадра: Ctrl-аккорд, F7 для кадра', () => {
    expect(frameKeyTitle('Копировать выделенные ячейки (C)', 'copy', false, false)).toBe('Копировать выделенные ячейки (Ctrl+C)');
    expect(frameKeyTitle('Вставить с заменой ячеек (V)', 'paste', false, false)).toBe('Вставить с заменой ячеек (Ctrl+V)');
    expect(frameKeyTitle('Добавить кадр после текущего (A; Ctrl+нажатие — перед)', 'add', false, false))
      .toBe('Добавить кадр после текущего (F7; Ctrl+нажатие — перед)');
    expect(frameKeyTitle('Объединить (M)', 'merge', false, false)).toBe('Объединить (Ctrl+M)');
  });

  it('с буквами подсказка не меняется, под Мультатором у «Объединить» клавиши нет', () => {
    expect(frameKeyTitle('Копировать выделенные ячейки (C)', 'copy', true, false)).toBe('Копировать выделенные ячейки (C)');
    expect(frameKeyTitle('Объединить (M)', 'merge', true, true)).toBe('Объединить');
    expect(frameKeyTitle('Объединить (M)', 'merge', false, true)).toBe('Объединить');
  });

  it('кнопки берут метку и подсказку из frameMenuKey, как меню кадра на ленте', () => {
    for (const [id, action, key] of [['copy', 'copy', 'copy'], ['paste', 'paste', 'paste'], ['merge', 'merge', 'merge'], ['add-frame', 'add', 'add_frame']]) {
      expect(item(id)).toContain(`data-key={menuKey('${action}')?.label}`);
      expect(item(id)).toContain(`title={frameKeyTitle(t('editor.${key}_title'), '${action}', editor.settings.letterKeys, quickPalette)}`);
    }
  });
});

describe('окно трансформации для экранного чтеца', () => {
  it('«Отразить» и шаги объявляют клавиши, которые называют', () => {
    expect(transformUi).toContain("aria-keyshortcuts={editor.settings.letterKeys ? 'H' : undefined}");
    expect(transformUi).toContain("aria-keyshortcuts={editor.settings.letterKeys ? 'Shift+H' : undefined}");
    expect(transformUi).toContain("aria-keyshortcuts={editor.settings.letterKeys ? 'Z Control+Z' : 'Control+Z'}");
    expect(transformUi).toContain("aria-keyshortcuts={editor.settings.letterKeys ? 'Y Control+Shift+Z' : 'Control+Shift+Z'}");
  });
});
