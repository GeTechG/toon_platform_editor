import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { draggable } from './draggable';
import { defaultPanels, movePanelItem } from './panels';
import { WORKSPACE_FILE_MAX, parseWorkspaces, pickedWorkspace, withWorkspace } from './workspaces';

// Четырнадцатый аудит, окна и раскладка. Svelte-клей проверяется по исходнику
// (как в audit11–13-windows), чистые части и действие перетаскивания — вживую.
const win = await Bun.file(new URL('./FloatWindow.svelte', import.meta.url)).text();
const arranger = await Bun.file(new URL('./PanelArranger.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();

function fn(source: string, name: string): string {
  return source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n  }\\n`))?.[0] ?? '';
}

// Каждое pointermove окна за заголовок писало всю настройку интерфейса в
// localStorage: JSON всего UI 60–120 раз в секунду, синхронно, пока другая
// рука рисует. Место пишется в хранилище один раз — когда окно отпущено.
describe('перетаскивание окна не пишет хранилище на каждый шаг', () => {
  test('setFloatPos умеет обновить место без записи', () => {
    const set = state.match(/\n  setFloatPos\([^]*?\n  }\n/)?.[0] ?? '';
    expect(set).toMatch(/persist = true/);
    expect(set).toMatch(/if \(persist\)/);
  });

  test('движение окна не пишет, отпускание пишет', () => {
    expect(fn(win, 'onMove')).toContain('false)');
    const up = fn(win, 'onUp');
    expect(up).toContain('editor.setFloatPos(');
    expect(up).toContain('moved');
  });
});

// Esc при открытом поверх раскладки листе (Alt+S открывает экспорт и в режиме
// раскладки) закрывал режим и гасил Esc — лист оставался открытым.
describe('Esc листа поверх раскладки принадлежит листу', () => {
  test('модальный лист или уже взятый Esc режим не закрывают', () => {
    const key = fn(arranger, 'onKeydown');
    expect(key).toContain('e.defaultPrevented');
    expect(key).toContain("dialog:modal");
    expect(key.indexOf('dialog:modal')).toBeLessThan(key.indexOf('e.preventDefault()'));
  });
});

describe('окно зума, спрятанное или повёрнутое, не теряет своё место', () => {
  let saved: { window: unknown; document: unknown };
  let win2: EventTarget & { innerWidth?: number };
  let node: HTMLElement;
  let hidden = false;
  let view = { clientWidth: 1000, clientHeight: 800 };

  function pointer(type: string, pointerId: number, x: number, y: number): Event {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { pointerId, clientX: x, clientY: y, button: 0, isPrimary: pointerId === 1 });
    return e;
  }

  beforeEach(() => {
    saved = { window: (globalThis as Record<string, unknown>).window, document: (globalThis as Record<string, unknown>).document };
    win2 = new EventTarget();
    hidden = false;
    view = { clientWidth: 1000, clientHeight: 800 };
    (globalThis as Record<string, unknown>).window = win2;
    (globalThis as Record<string, unknown>).document = {
      // Тело длиннее экрана: страница под студией прокручивается.
      body: { clientWidth: 1000, clientHeight: 3000 },
      documentElement: view,
    };
    const target = new EventTarget() as EventTarget & Record<string, unknown>;
    const style: Record<string, string> = {};
    Object.assign(target, {
      style,
      closest: () => target,
      contains: () => true,
      setPointerCapture: () => {},
      getBoundingClientRect: () => hidden
        ? { left: 0, top: 0, width: 0, height: 0 }
        : {
            left: Number.parseFloat(style.left ?? '100'),
            top: Number.parseFloat(style.top ?? '100'),
            width: 100,
            height: 50,
          },
    });
    node = target as unknown as HTMLElement;
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).window = saved.window;
    (globalThis as Record<string, unknown>).document = saved.document;
  });

  function dragTo(x: number, y: number): void {
    node.dispatchEvent(pointer('pointerdown', 1, 110, 110));
    win2.dispatchEvent(pointer('pointermove', 1, x, y));
    win2.dispatchEvent(pointer('pointerup', 1, x, y));
  }

  test('окно держится в видимом экране, а не в длинном теле страницы', () => {
    const drag = draggable(node);
    dragTo(110, 2000);
    expect(node.style.top).toBe('750px');
    drag.destroy();
  });

  test('спрятанное окно (display: none) при ресайзе не уезжает в угол', () => {
    const drag = draggable(node);
    dragTo(610, 410);
    expect(node.style.left).toBe('600px');
    hidden = true;
    win2.dispatchEvent(new Event('resize'));
    expect(node.style.left).toBe('600px');
    expect(node.style.top).toBe('400px');
    drag.destroy();
  });

  test('поворот туда и обратно возвращает окно на место руки', () => {
    const drag = draggable(node);
    dragTo(810, 410);
    expect(node.style.left).toBe('800px');
    view.clientWidth = 500;
    win2.dispatchEvent(new Event('resize'));
    expect(node.style.left).toBe('400px');
    view.clientWidth = 1000;
    win2.dispatchEvent(new Event('resize'));
    expect(node.style.left).toBe('800px');
    drag.destroy();
  });
});

// Выбран по ошибке видеофайл на гигабайты: file.text() читал его целиком и
// ронял вкладку вместе с несохранённым рисунком.
describe('файл раскладок не читается целиком, если он огромный', () => {
  test('потолок есть и проверяется до чтения', () => {
    expect(WORKSPACE_FILE_MAX).toBeGreaterThanOrEqual(64 * 1024);
    expect(WORKSPACE_FILE_MAX).toBeLessThanOrEqual(1024 * 1024);
    const load = fn(arranger, 'onWorkspaceFile');
    expect(load).toContain('WORKSPACE_FILE_MAX');
    expect(load.indexOf('WORKSPACE_FILE_MAX')).toBeLessThan(load.indexOf('file.text()'));
  });

  // Math.max(...ids) на ~150 тысячах записей переполнял стек (Chrome; bun — на
  // миллионе), и загрузка падала без слова.
  test('много записей не роняют разбор', () => {
    const many = Array.from({ length: 1_000_000 }, (_, i) => ({ id: i + 1 }));
    const raw = JSON.stringify([...many, { name: 'Стол' }]);
    const list = parseWorkspaces(raw);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(1_000_001);
  });
});

// Выбрана «Стол», потом «Сбросить» или перенос руками: список всё ещё
// говорил «Стол», а «Скачать» отдавал сохранённый «Стол», не то, что на экране.
describe('список раскладок показывает то, что сейчас на экране', () => {
  const panels = defaultPanels();
  const list = withWorkspace([], 'Стол', panels, {});

  test('пока раскладка та же — она выбрана', () => {
    expect(pickedWorkspace(String(list[0].id), list, panels, {})).toBe(String(list[0].id));
  });

  test('переставили руками — выбора нет', () => {
    const moved = movePanelItem(panels, 'palette', 'float');
    expect(pickedWorkspace(String(list[0].id), list, moved, {})).toBe('');
  });

  test('удалённая раскладка не выбрана', () => {
    expect(pickedWorkspace('999', list, panels, {})).toBe('');
    expect(pickedWorkspace('', list, panels, {})).toBe('');
  });

  test('полоса берёт выбор через эту проверку', () => {
    expect(arranger).toContain('pickedWorkspace(');
    expect(arranger).toMatch(/value=\{shownPick\}/);
    expect(arranger).toMatch(/disabled=\{!shownPick\}/);
    expect(fn(arranger, 'downloadWorkspace')).toContain('shownPick');
  });
});

// Перо, чей отпуск проглотило меню, тоже водит «призрак» по наведению:
// кнопок у него 0, как у мыши.
describe('потерянный отпуск пера бросает перенос, как у мыши', () => {
  test('проверка не только для мыши', () => {
    const move = fn(arranger, 'onPointerMove');
    expect(move).toContain("e.pointerType !== 'touch' && e.buttons === 0");
  });
});

// Брошенное на холст окно запоминало место за краем: нарисовано оно внутри,
// а сохранённая раскладка хранила другое — как у перетаскивания за заголовок.
describe('окно, брошенное на край, запоминает место, где его видно', () => {
  test('место после броска прижимается тем же зажимом', () => {
    expect(arranger).toContain('clampWindowPosition');
    const settle = fn(arranger, 'settle');
    expect(settle).toContain('await tick()');
    expect(settle).toContain('clampWindowPosition(');
  });
});

describe('окно не выше редактора и меряет редактор, даже спрятанный', () => {
  test('окно не выше своей рамки, тело прокручивается', () => {
    const rule = win.match(/\n  \.float \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/max-height:\s*100%/);
  });

  test('рамка — корень окон, а не offsetParent (null у спрятанного)', () => {
    expect(win).toContain("closest<HTMLElement>('[data-float-root]')");
    expect(win).not.toContain('offsetParent');
  });
});

// Ctrl/Alt/Meta со стрелкой — браузер и читалка (Alt+← — назад), не сдвиг окна.
describe('стрелки с модификатором окно не двигают', () => {
  test('клавиша с Ctrl, Alt или Meta проходит мимо', () => {
    const key = fn(win, 'onKey');
    expect(key).toMatch(/e\.ctrlKey \|\| e\.altKey \|\| e\.metaKey/);
  });
});

// Имя из файла с пробелами по краям («Стол » рядом со «Стол») читалось
// отдельной раскладкой: «Сохранить» имена обрезает, файл — нет, и вопрос о
// замене одноимённой не задавался.
describe('имя раскладки из файла читается так же, как набранное', () => {
  test('пробелы по краям обрезаются', () => {
    expect(parseWorkspaces(JSON.stringify([{ name: '  Стол ' }]))[0].name).toBe('Стол');
  });
});
