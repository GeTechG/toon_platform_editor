import { describe, expect, test } from 'bun:test';
import * as drag from './draggable';
import { defaultPanels } from './panels';
import { importWorkspaces, parseWorkspaces, withWorkspace } from './workspaces';

// Девятнадцатый аудит, окна и раскладка. Клей Svelte проверяется по исходнику
// (как в audit11–18-windows), чистые части — вживую.
const win = await Bun.file(new URL('./FloatWindow.svelte', import.meta.url)).text();
const shell = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const arranger = await Bun.file(new URL('./PanelArranger.svelte', import.meta.url)).text();

// Окно на узком экране рисуется вдвинутым, а помнит своё место (15-й аудит).
// Но заголовок считал переносом любой pointermove: перо, сменившее нажим, или
// дрогнувший палец — и «перенос» на 0–1 px записывал вдвинутое место вместо
// своего. На широком экране окно уже не возвращалось, а раскладка считалась
// переставленной руками.
describe('нажатие на заголовок окна — ещё не перенос', () => {
  test('порог тот же, что у окон инструментов: 4 px мышью и пером, 10 px пальцем', () => {
    const past = (drag as Record<string, unknown>).pastDragThreshold as
      (dx: number, dy: number, pointerType: string) => boolean;
    expect(past(0, 0, 'pen')).toBe(false);
    expect(past(3, 0, 'mouse')).toBe(false);
    expect(past(4, 0, 'mouse')).toBe(true);
    expect(past(0, -4, 'pen')).toBe(true);
    expect(past(6, 6, 'touch')).toBe(false);
    expect(past(8, 8, 'touch')).toBe(true);
  });

  test('заголовок не двигает окно, пока порог не пройден', () => {
    const onMove = win.slice(win.indexOf('function onMove('), win.indexOf('function onUp('));
    const gate = onMove.indexOf('pastDragThreshold(e.clientX - grab.x, e.clientY - grab.y, e.pointerType)');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(onMove.indexOf('grab.moved = true'));
    expect(gate).toBeLessThan(onMove.indexOf('editor.setFloatPos('));
  });
});

// «Сохранено» до первой записи пусто. В строке его ручка держит ширину клавиши
// (15-й аудит), а в боковой колонке широкий предмет тянется по ширине — и
// ручка была полоской 105×4 px: ни мышью, ни пальцем не взять обратно.
describe('пустой широкий предмет в колонке можно взять', () => {
  test('ручка широкого предмета не ниже клавиши', () => {
    // Распоркой, а не min-height: тот отменял автоматический минимум (audit20-system).
    expect(shell).toMatch(/\.editor\.arranging \.arr\.wide::before \{[^}]*height: var\(--key-h\);/);
  });
});

// С полки предмет берут пальцем (планшет лёжа — полная раскладка): 36 px
// меньше принятых в студии 44.
describe('предмет на полке — цель для пальца', () => {
  test('высота не меньше клавиши', () => {
    const chip = arranger.slice(arranger.indexOf('\n  .chip {'), arranger.indexOf('\n  .arrange-keys {'));
    expect(chip).toContain('min-height: var(--key-h, 2.75rem);');
    expect(chip).not.toContain('2.25rem');
  });
});

// Номер раскладки из файла — любое число. За 2^53 «следующий свободный»
// (max + 1) — то же самое число: три раскладки получали один номер, и список
// с ключом по номеру падал (each_key_duplicate).
describe('огромный номер раскладки в файле не даёт повторов', () => {
  const panels = defaultPanels();
  const raw = JSON.stringify([
    { id: 2 ** 53, name: 'а', panels },
    { name: 'б', panels },
    { name: 'в', panels },
    { id: Number.MAX_SAFE_INTEGER, name: 'г', panels },
  ]);

  test('разбор даёт разные номера', () => {
    const ids = parseWorkspaces(raw).map((w) => w.id);
    expect(ids.length).toBe(4);
    expect(new Set(ids).size).toBe(4);
    expect(ids.every((id) => Number.isSafeInteger(id))).toBe(true);
  });

  test('и сохранение после загрузки — тоже', () => {
    const { workspaces } = importWorkspaces([], raw);
    const next = withWorkspace(withWorkspace(workspaces, 'д', panels, {}), 'е', panels, {});
    expect(new Set(next.map((w) => w.id)).size).toBe(6);
  });

  test('обычные номера остаются как были', () => {
    const plain = JSON.stringify([{ id: 3, name: 'а', panels }, { id: 7, name: 'б', panels }]);
    expect(parseWorkspaces(plain).map((w) => w.id)).toEqual([3, 7]);
  });
});
