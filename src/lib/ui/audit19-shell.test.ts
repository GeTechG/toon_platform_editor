import { describe, expect, it } from 'bun:test';
import { keyOwner, type KeyPress, type KeyTarget } from './key-owner';

// Девятнадцатый аудит, оболочка студии. Editor.svelte проверяется как исходник,
// как в audit18-shell.test.ts; что можно запустить по-настоящему — запускается.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

/** Кнопка, на которую пришли мышью: Пробел и Enter на ней — клавиши студии. */
const button: KeyTarget = {
  tagName: 'BUTTON',
  isContentEditable: false,
  getAttribute: () => null,
  matches: () => false,
};

const press = (key: string, patch: Partial<KeyPress> = {}): KeyPress => ({
  key,
  target: button,
  defaultPrevented: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  modalOpen: false,
  letterKeys: true,
  ...patch,
});

describe('клавиша, которой нет в таблице студии', () => {
  it('остаётся браузеру: зажатый Tab шагал на одну кнопку и вставал — автоповтор студия гасила как «свой»', () => {
    for (const key of ['Tab', 'PageDown', 'PageUp', 'Home', 'End', 'F5', 'F11', 'ContextMenu', 'Shift']) {
      expect(keyOwner(press(key))).toBe('control');
      expect(keyOwner(press(key, { target: null }))).toBe('control');
    }
    expect(keyOwner(press('Tab', { shiftKey: true }))).toBe('control');
  });

  it('именованные клавиши таблицы — по-прежнему студии', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Delete', 'Backspace', 'F7', ' ', 'b']) {
      expect(keyOwner(press(key))).toBe('editor');
    }
    expect(keyOwner(press('F7', { ctrlKey: true }))).toBe('editor');
    expect(keyOwner(press('ArrowLeft', { ctrlKey: true, shiftKey: true }))).toBe('editor');
  });
});

function fn(name: string): string {
  const match = editorUi.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

describe('сдвиг, записанный из фона', () => {
  it('оставляет рисунок несохранённым: брошенный по Esc сдвиг жил в черновике, «Сохранить» не горела, вкладка закрывалась без вопроса', () => {
    // Запись сама гасит dirty — флаг ставится после неё, а не до.
    expect(fn('flushOnHide')).toMatch(/void saveNow\(false, true, shown\);\s*(?:\/\/.*\s*)*editor\.touched = true;\s*dirty = true;\s*return;/);
  });

  it('часы ждут, пока вкладка скрыта: иначе через минуту они писали рисунок без сдвига поверх записи со сдвигом', () => {
    expect(editorUi).toMatch(/setInterval\(\(\) => \{\s*(?:\/\/.*\s*)*if \(!dirty \|\| document\.hidden\) \{\s*return;/);
  });

  it('пишется и на только что открытом черновике: он «не тронут», пока сдвиг не применён, и запись молча пропускалась', () => {
    expect(fn('saveNow')).toMatch(/if \(!editor\.touched && !shown\) \{\s*return Promise\.resolve\(true\);/);
  });
});
