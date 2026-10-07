import { describe, expect, test } from 'bun:test';
import * as panels from './panels';
import * as palette from './color-palette';
import ru from '../i18n/ru.json';

// Двадцатый аудит, остатки сборщика и ответы владельца после девятнадцатого.
const shell = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const canvas = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
const arranger = await Bun.file(new URL('./PanelArranger.svelte', import.meta.url)).text();
const box = await Bun.file(new URL('./PaletteBox.svelte', import.meta.url)).text();
const sheet = await Bun.file(new URL('./ExportSheet.svelte', import.meta.url)).text();

// `showHint` читает `hint` и пишет его: эффект зависел от собственной записи,
// и когда таймер гасил подсказку, уходил в бесконечный цикл
// (`effect_update_depth_exceeded`) — студия не отвечала до перезагрузки.
describe('подсказка от состояния не вешает студию', () => {
  test('эффект слышит только слова студии, не свою запись', () => {
    expect(canvas).toContain('untrack(() => showHint(said.text))');
    expect(canvas).not.toMatch(/\$effect\(\(\) => \{\s*if \(editor\.canvasHint\) \{\s*showHint\(/);
  });
});

// Владелец, после 19-го аудита: бросок на свёрнутую нижнюю панель кладёт
// предмет в конец последней строки, панель разворачивается.
describe('свёрнутая нижняя панель принимает бросок', () => {
  test('в режиме раскладки она — цель: последняя строка', () => {
    expect(shell).toContain('data-slot={panelFolded && editor.arranging ? `row:${Math.max(0, panels.rows.length - 1)}` : undefined}');
    expect(shell).toContain('data-folded={panelFolded && editor.arranging ? \'\' : undefined}');
    expect(arranger).toContain('panelEl.dataset.folded !== undefined');
  });
  test('предмет встаёт в конец строки, какой бы индекс ни пришёл', () => {
    const layout = { ...panels.defaultPanels(), rows: [['transport'], ['timeline', 'save']], hidden: ['manual'] };
    const next = panels.movePanelItem(layout, 'manual', 'row:1' as panels.PanelSlot, Number.MAX_SAFE_INTEGER);
    expect(next.rows[1]).toEqual(['timeline', 'save', 'manual']);
    expect(next.rows).toHaveLength(2);
  });
  test('у свёрнутой панели в раскладке есть высота, в которую можно попасть', () => {
    expect(shell).toMatch(/\.editor\.arranging \.panel\.collapsed \{\s*height: var\(--key-h\);/);
  });
});

// Владелец, после 19-го аудита: «Загрузить» палитру больше лимита — в вопросе
// сказано, сколько цветов не поместится.
describe('загрузка палитры больше лимита предупреждает', () => {
  const over = (palette as Record<string, unknown>).overLimit as (colours: readonly string[], limit: number) => number;
  test('счёт — по разным цветам', () => {
    expect(over(['#000000', '#000000', '#ffffff'], 2)).toBe(0);
    expect(over(['#000000', '#111111', '#ffffff'], 2)).toBe(1);
    expect(over([], 50)).toBe(0);
  });
  test('вопрос называет число и лимит', () => {
    expect(ru.palette.replace_over_confirm).toContain('{{skipped}}');
    expect(ru.palette.replace_over_confirm).toContain('{{limit}}');
    expect(box).toContain("t('palette.replace_over_confirm', { skipped, limit })");
  });
});

// Пока трек открытого черновика читается, в студии ещё трек прежнего: мульт
// и видео уходили с чужим звуком.
describe('чужой трек не уходит с мультом', () => {
  test('«Отправить» и «Скачать» ждут, пока трек читается', () => {
    expect(shell).toMatch(/class="key primary publish"[^>]*disabled=\{editor\.audio\.loading\}/s);
    expect(sheet).toContain('editor.audio.loading');
  });
});

// Плашка «Звук», открытая до режима раскладки, оставалась под плашкой
// раскладки: закрыть её было нечем, клавиша «Звук» там — ручка.
describe('режим раскладки закрывает плашку «Звук»', () => {
  test('вход в раскладку её закрывает', () => {
    expect(shell).toContain('if (editor.arranging) audioOpen = false;');
  });
});

describe('колонка: проверка, которая ничего не проверяла', () => {
  test('инструмент без записи в реестре держит место, пока плагины грузятся', () => {
    const draws = panels.columnDraws;
    expect(draws(['tool:ghost.plugin'], { pipette: false, publish: false, fullscreen: false })).toBe(true);
  });
});
