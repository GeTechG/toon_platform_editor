import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { draggable } from './draggable';
import { defaultPanels, movePanelItem, normalizePanels, type PanelLayout } from './panels';
import { parseWorkspaces } from './workspaces';

// Восемнадцатый аудит, окна и раскладка. Клей Svelte проверяется по исходнику
// (как в audit11–17-windows), чистые части и действие переноса — вживую.
const win = await Bun.file(new URL('./FloatWindow.svelte', import.meta.url)).text();
const shell = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const toolKey = await Bun.file(new URL('./ToolKey.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();

function member(head: string): string {
  const from = state.indexOf(`\n  ${head}`);
  return from < 0 ? '' : state.slice(from, state.indexOf('\n  }\n', from));
}

// Раскладка читается до установленных плагинов, и клавиша плагина держит своё
// место (владелец, 13-й аудит). Но ключ строки — сам id, строка не
// перерисовывается, а реестр плагинов — не состояние: клавиша, нарисованная
// пустой до прихода плагина, пустой и оставалась — после каждой перезагрузки
// страницы инструмент плагина пропадал с панели до первой перестановки.
describe('клавиша плагина появляется, когда плагин загрузился', () => {
  test('панель перечитывает инструмент по pluginsVersion', () => {
    expect(shell).toContain('{@const tool = (void editor.pluginsVersion, toolOfItem(id))}');
  });

  test('клавиша перечитывает свой значок и подпись (обновление плагина)', () => {
    expect(toolKey).toMatch(/const spec = \$derived\(\(void editor\.pluginsVersion, toolSpec\(tool\)\)\)/);
  });

  test('окно называет себя именем инструмента, а не «tool:…»', () => {
    expect(win).toMatch(/const item = \$derived\(\(void editor\.pluginsVersion, panelItem\(id\)\)\)/);
    expect(win).toContain('item?.label ?? id');
  });

  test('пока плагина нет, окна не видно — пустая рамка с сырым id не мелькает', () => {
    expect(win).toContain('class:waiting={!item}');
    expect(win).toMatch(/\.float\.waiting \{\s*display: none;/);
  });
});

// Раскладка из файла с другой машины несёт клавиши плагинов, которых здесь
// нет. Разбор их бережёт (плагины могут ещё грузиться), и такая клавиша в
// «окнах» становилась пустым окном «tool:…», которое не закрыть: × и полка
// не знают такого предмета.
describe('раскладка из файла не приносит клавиш плагинов, которых нет', () => {
  const raw = JSON.stringify([{
    id: 1,
    name: 'Стол',
    panels: { ...defaultPanels(), float: ['tool:audit18-ghost'] },
    floatPos: {},
  }]);

  test('разбор бережёт клавишу, чистка её убирает', () => {
    const [stored] = parseWorkspaces(raw);
    expect(stored.panels.float).toEqual(['tool:audit18-ghost']);
    expect(normalizePanels(stored.panels).float).toEqual([]);
  });

  test('загрузка файла чистит список, когда плагины уже загружены', () => {
    const load = member('importWorkspaces(raw: string): { loaded: number; kept: number } {');
    expect(load).toMatch(/if \(this\.pluginsVersion > 0\) \{\s*this\.dropGhostKeys\(\);/);
    expect(member('refreshPlugins(): void {')).toContain('this.dropGhostKeys()');
    expect(member('private dropGhostKeys(): void {')).toContain('normalizePanels(w.panels)');
  });
});

// Все предметы унесли из нижней панели — строк не осталось. В режиме
// раскладки панель рисовалась, но без единой цели для броска: вернуть в неё
// что-либо можно было только «Сбросить», потеряв расстановку.
describe('в пустую нижнюю панель можно бросить', () => {
  test('без строк панель предлагает новую строку', () => {
    expect(shell).toMatch(/\{#if editor\.arranging && panels\.rows\.length === 0\}[^]*?data-slot="newrow:0"/);
  });

  test('бросок туда делает первую строку', () => {
    const bare: PanelLayout = { ...defaultPanels(), rows: [], left: [...defaultPanels().left, 'timeline'] };
    expect(movePanelItem(bare, 'timeline', 'newrow:0', 0).rows).toEqual([['timeline']]);
  });
});

// Контейнер запросов на сцене — в Safari до 18.4 (и прежних Chrome/Firefox)
// это ещё и layout containment: сцена становится опорой для `position: fixed`
// и своим слоем. Окна зума и трансформации при переносе прыгали на ширину
// левой колонки, кольцо кисти стояло в стороне от курсора, а поднять окно
// инструмента над плавающим было нельзя.
describe('сцена не становится опорой для fixed-окон', () => {
  test('у сцены нет container, подсказка поднимается по классу', () => {
    expect(shell).not.toMatch(/container: stage/);
    expect(shell).not.toContain('@container stage');
    expect(shell).toContain('class:narrow={stageWidth < 44 * rem}');
    expect(shell).toContain('.studio .stage.narrow :global(.hint)');
  });
});

// Ctrl+щелчок на Маке (или правая кнопка поверх левой) открывает меню, и оно
// съедает отпускание: окно зума потом ездило за голым курсором.
describe('потерянное отпускание бросает перенос окна инструмента', () => {
  let saved: { window: unknown; document: unknown };
  let win2: EventTarget;
  let node: HTMLElement;

  function pointer(type: string, x: number, more: Record<string, unknown> = {}): Event {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { pointerId: 1, clientX: x, clientY: 110, button: 0, isPrimary: true, ...more });
    return e;
  }

  beforeEach(() => {
    saved = { window: (globalThis as Record<string, unknown>).window, document: (globalThis as Record<string, unknown>).document };
    win2 = new EventTarget();
    (globalThis as Record<string, unknown>).window = win2;
    (globalThis as Record<string, unknown>).document = { body: { clientWidth: 1000, clientHeight: 800 } };
    const target = new EventTarget() as EventTarget & Record<string, unknown>;
    const style: Record<string, string> = {};
    Object.assign(target, {
      style,
      closest: () => target,
      contains: () => true,
      setPointerCapture: () => {},
      getBoundingClientRect: () => ({
        left: Number.parseFloat(style.left ?? '100'),
        top: Number.parseFloat(style.top ?? '100'),
        width: 100,
        height: 50,
      }),
    });
    node = target as unknown as HTMLElement;
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).window = saved.window;
    (globalThis as Record<string, unknown>).document = saved.document;
  });

  test('мышь без нажатой кнопки окно не двигает', () => {
    const drag = draggable(node);
    node.dispatchEvent(pointer('pointerdown', 110));
    win2.dispatchEvent(pointer('pointermove', 160, { pointerType: 'mouse', buttons: 0 }));
    expect(node.style.left).toBeUndefined();
    // И дальше тоже: перенос отпущен, а не отложен.
    win2.dispatchEvent(pointer('pointermove', 200, { pointerType: 'mouse', buttons: 1 }));
    expect(node.style.left).toBeUndefined();
    drag.destroy();
  });

  test('палец кнопок не несёт и переносит как прежде', () => {
    const drag = draggable(node);
    node.dispatchEvent(pointer('pointerdown', 110));
    win2.dispatchEvent(pointer('pointermove', 130, { pointerType: 'touch', buttons: 0 }));
    expect(node.style.left).toBe('120px');
    drag.destroy();
  });
});
