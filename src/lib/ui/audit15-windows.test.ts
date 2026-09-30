import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { draggable } from './draggable';
import { defaultPanels, movePanelItem } from './panels';
import { loadWorkspaces, parseWorkspaces, withWorkspace } from './workspaces';

// Пятнадцатый аудит, окна и раскладка. Svelte-клей проверяется по исходнику
// (как в audit11–14-windows), чистые части и действие перетаскивания — вживую.
const arranger = await Bun.file(new URL('./PanelArranger.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

function fn(source: string, name: string): string {
  return source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n  }\\n`))?.[0] ?? '';
}
function member(head: string): string {
  const from = state.indexOf(`\n  ${head}`);
  return from < 0 ? '' : state.slice(from, state.indexOf('\n  }\n', from));
}

// Японский или китайский ввод: Enter, который выбирает иероглиф, сохранял
// раскладку под недописанным именем, а Esc, который бросает набор, стирал всё
// имя и ещё закрывал режим раскладки.
describe('ввод через IME в имени раскладки не сохраняет и не закрывает', () => {
  test('поле имени пропускает клавиши, пока идёт набор', () => {
    const field = arranger.slice(arranger.indexOf('class="ws-name"'), arranger.indexOf('</button>', arranger.indexOf('class="ws-name"')));
    expect(field).toContain('composing(e)');
    expect(field.indexOf('composing(e)')).toBeLessThan(field.indexOf("e.key === 'Enter'"));
  });

  test('Esc набора не закрывает режим', () => {
    expect(fn(arranger, 'onKeydown')).toContain('composing(e)');
  });
});

// aria-label на div без роли запрещён (ARIA 1.2: generic не называется) —
// чтец полку не называл.
describe('полка названа как группа', () => {
  test('у полки есть роль, которой имя разрешено', () => {
    expect(arranger).toMatch(/class="tray" role="group" data-slot="hidden"/);
  });
});

class MemoryStorage {
  map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  setItem(key: string, value: string): void { this.map.set(key, String(value)); }
}

// Две вкладки студии: раскладка, сохранённая в одной, стиралась, когда
// другая (со старым списком в памяти) сохраняла, загружала или удаляла свою.
describe('раскладки другой вкладки не теряются', () => {
  let saved: unknown;
  beforeEach(() => {
    saved = (globalThis as Record<string, unknown>).localStorage;
  });
  afterEach(() => {
    (globalThis as Record<string, unknown>).localStorage = saved;
  });

  test('список читается заново из хранилища', () => {
    const store = new MemoryStorage();
    store.setItem('toon-editor:workspaces', JSON.stringify(withWorkspace([], 'Стол', defaultPanels(), {})));
    (globalThis as Record<string, unknown>).localStorage = store;
    const mine = withWorkspace([], 'Планшет', defaultPanels(), {});
    expect(loadWorkspaces(mine).map((w) => w.name)).toEqual(['Стол']);
  });

  test('без хранилища остаётся список из памяти — его единственная копия', () => {
    const mine = withWorkspace([], 'Планшет', defaultPanels(), {});
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: () => { throw new Error('SecurityError'); },
    };
    expect(loadWorkspaces(mine)).toBe(mine);
    (globalThis as Record<string, unknown>).localStorage = new MemoryStorage();
    expect(loadWorkspaces(mine)).toBe(mine);
  });

  test('сохранение, загрузка и удаление начинают с хранилища', () => {
    for (const head of ['saveWorkspace(name: string)', 'importWorkspaces(raw: string)', 'deleteWorkspace(id: number)']) {
      expect(member(head)).toContain('this.workspaces = loadWorkspaces(this.workspaces)');
    }
  });

  test('удаляется раскладка по имени, а не по номеру из старого списка', () => {
    const del = member('deleteWorkspace(id: number)');
    expect(del.indexOf('?.name')).toBeLessThan(del.indexOf('loadWorkspaces('));
    expect(del).toContain('.name !== name');
  });
});

// Место окна из файла могло быть отрицательным; настройка интерфейса после
// перезагрузки прижимала его к 0 — и раскладка «менялась» сама: список терял
// выбор, «Сбросить» спрашивал о расстановке, которой никто не трогал.
describe('место окна из файла читается так же, как из настроек', () => {
  test('отрицательные координаты — ноль', () => {
    const panels = movePanelItem(defaultPanels(), 'palette', 'float');
    const [w] = parseWorkspaces(JSON.stringify([{ id: 1, name: 'Стол', panels, floatPos: { palette: { x: -40, y: -7.6 } } }]));
    expect(w.floatPos.palette).toEqual({ x: 0, y: 0 });
  });
});

// Тянули край колонки или нижней панели — вся настройка интерфейса шла в
// localStorage на каждое движение указателя (как было у окон до audit14).
describe('ресайз панели пишет хранилище один раз, при отпускании', () => {
  test('setSideWidth и setPanelHeight умеют без записи', () => {
    for (const head of ['setSideWidth(', 'setPanelHeight(']) {
      const body = member(head);
      expect(body).toContain('persist = true');
      expect(body).toMatch(/if \(persist\)/);
    }
  });

  test('движение не пишет, отпускание пишет', () => {
    expect(fn(editorUi, 'onDividerMove')).toContain(', false)');
    expect(fn(editorUi, 'onDividerUp')).toContain('resize.apply(');
  });
});

// Правая кнопка на крае колонки начинала ресайз; контекстное меню съедало
// отпускание, и колонка ездила за голым курсором до следующего клика.
describe('край панели тянет только основная кнопка', () => {
  test('другая кнопка ресайз не начинает', () => {
    expect(fn(editorUi, 'startResize')).toContain('e.button !== 0');
  });

  test('мышь или перо без нажатой кнопки отпускают край', () => {
    expect(fn(editorUi, 'onDividerMove')).toContain("e.pointerType !== 'touch' && e.buttons === 0");
  });
});

// Alt+← на крае колонки — «назад» браузера, Ctrl+Shift+стрелки — панорама
// листа; край забирал их себе и менял ширину.
describe('стрелки с модификатором край панели не двигают', () => {
  test('колонка и нижняя панель', () => {
    for (const name of ['onSideKey', 'onDividerKey']) {
      expect(fn(editorUi, name)).toContain('e.ctrlKey || e.altKey || e.metaKey');
    }
  });
});

describe('палец, чуть дрогнувший на клавише окна зума, жмёт клавишу', () => {
  let saved: { window: unknown; document: unknown };
  let win: EventTarget;
  let node: HTMLElement;

  function pointer(type: string, x: number, y: number, pointerType: string): Event {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { pointerId: 1, clientX: x, clientY: y, button: 0, isPrimary: true, pointerType });
    return e;
  }

  beforeEach(() => {
    saved = { window: (globalThis as Record<string, unknown>).window, document: (globalThis as Record<string, unknown>).document };
    win = new EventTarget();
    (globalThis as Record<string, unknown>).window = win;
    (globalThis as Record<string, unknown>).document = { documentElement: { clientWidth: 1000, clientHeight: 800 } };
    const target = new EventTarget() as EventTarget & Record<string, unknown>;
    Object.assign(target, {
      style: {},
      closest: () => target,
      contains: () => true,
      setPointerCapture: () => {},
      getBoundingClientRect: () => ({ left: 100, top: 100, width: 100, height: 50 }),
    });
    node = target as unknown as HTMLElement;
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).window = saved.window;
    (globalThis as Record<string, unknown>).document = saved.document;
  });

  test('касание со сдвигом в 7 px — нажатие, не перенос', () => {
    const drag = draggable(node);
    node.dispatchEvent(pointer('pointerdown', 110, 110, 'touch'));
    win.dispatchEvent(pointer('pointermove', 117, 110, 'touch'));
    expect(node.style.position).toBeUndefined();
    win.dispatchEvent(pointer('pointerup', 117, 110, 'touch'));
    drag.destroy();
  });

  test('мышь по-прежнему трогается с 4 px', () => {
    const drag = draggable(node);
    node.dispatchEvent(pointer('pointerdown', 110, 110, 'mouse'));
    win.dispatchEvent(pointer('pointermove', 117, 110, 'mouse'));
    expect(node.style.position).toBe('fixed');
    win.dispatchEvent(pointer('pointerup', 117, 110, 'mouse'));
    drag.destroy();
  });
});
