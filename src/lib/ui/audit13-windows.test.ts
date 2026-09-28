import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { draggable } from './draggable';
import { defaultPanels, movePanelItem, samePanels } from './panels';

// Thirteenth audit, floating windows and the arrangement. The Svelte glue is
// asserted as source (the contract style of audit11/12-windows); the pure
// parts and the drag action run for real.
const win = await Bun.file(new URL('./FloatWindow.svelte', import.meta.url)).text();
const arranger = await Bun.file(new URL('./PanelArranger.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const ru = JSON.parse(await Bun.file(new URL('../i18n/ru.json', import.meta.url)).text());

function fn(source: string, name: string): string {
  return source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n  }\\n`))?.[0] ?? '';
}

// The order of the windows is their stacking: a press on the one behind
// raises it. Compared as an arrangement, that press made the hand's own
// arrangement «new» — picking a saved one or «Сбросить» then asked whether to
// throw away an arrangement nobody had touched.
describe('raising a window is not rearranging', () => {
  test('two arrangements that differ only in which window is in front are the same', () => {
    const two = movePanelItem(movePanelItem(defaultPanels(), 'palette', 'float'), 'brush', 'float');
    const raised = movePanelItem(two, 'palette', 'float');
    expect(raised.float).toEqual(['brush', 'palette']);
    expect(samePanels(two, raised)).toBe(true);
  });

  test('a window more or less still is a change', () => {
    const one = movePanelItem(defaultPanels(), 'palette', 'float');
    expect(samePanels(one, defaultPanels())).toBe(false);
  });
});

// A right press (or the wheel) on an item picked it up. The context menu that
// opens on it swallows the release, and the ghost then followed the bare
// hover until the next click dropped the item wherever that was.
describe('only the main button picks an item up', () => {
  test('the arranger ignores any other button', () => {
    expect(fn(arranger, 'onPointerDown')).toContain('e.button !== 0');
  });

  test('a mouse moving with no button down has lost its release, and the drag is let go', () => {
    const move = fn(arranger, 'onPointerMove');
    expect(move).toContain("e.pointerType === 'mouse' && e.buttons === 0");
  });

  test('a window bar takes no grab from another button', () => {
    expect(fn(win, 'onDown')).toContain('e.button !== 0');
  });

  test('a window lets go when it loses the pointer, whatever took it', () => {
    expect(win).toContain('onlostpointercapture={onUp}');
    expect(fn(win, 'onUp')).not.toContain('pointerId ===');
  });
});

// The zoom and transform windows: a second finger anywhere — a tap on a key,
// a pinch starting on the canvas — ended the drag of the first, and a second
// finger on the handle took the window over.
describe('the drag of a tool window belongs to the finger that started it', () => {
  let saved: { window: unknown; document: unknown };
  let win2: EventTarget;
  let node: HTMLElement;

  function pointer(type: string, pointerId: number, x: number, y: number): Event {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { pointerId, clientX: x, clientY: y, button: 0, isPrimary: pointerId === 1 });
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

  test('another finger lifting does not end it', () => {
    const drag = draggable(node);
    node.dispatchEvent(pointer('pointerdown', 1, 110, 110));
    win2.dispatchEvent(pointer('pointermove', 1, 130, 110));
    expect(node.style.left).toBe('120px');
    win2.dispatchEvent(pointer('pointerup', 2, 500, 500));
    win2.dispatchEvent(pointer('pointermove', 1, 150, 110));
    expect(node.style.left).toBe('140px');
    drag.destroy();
  });

  test('another finger on the handle does not take it over', () => {
    const drag = draggable(node);
    node.dispatchEvent(pointer('pointerdown', 1, 110, 110));
    win2.dispatchEvent(pointer('pointermove', 1, 130, 110));
    node.dispatchEvent(pointer('pointerdown', 2, 400, 400));
    win2.dispatchEvent(pointer('pointermove', 2, 600, 600));
    expect(node.style.left).toBe('120px');
    win2.dispatchEvent(pointer('pointermove', 1, 140, 110));
    expect(node.style.left).toBe('130px');
    drag.destroy();
  });

  test('its own release still ends it', () => {
    const drag = draggable(node);
    node.dispatchEvent(pointer('pointerdown', 1, 110, 110));
    win2.dispatchEvent(pointer('pointermove', 1, 130, 110));
    win2.dispatchEvent(pointer('pointerup', 1, 130, 110));
    win2.dispatchEvent(pointer('pointermove', 1, 300, 110));
    expect(node.style.left).toBe('120px');
    drag.destroy();
  });
});

// Saving under a name already in the list replaced that arrangement without a
// word — the one loss of a saved arrangement left unasked after the twelfth
// audit made picking and deleting ask.
describe('saving over a named arrangement asks first', () => {
  const save = state.match(/\n  saveWorkspace\([^]*?\n  }\n/)?.[0] ?? '';

  test('the same name with another arrangement is a question', () => {
    expect(save).toContain("this.confirmed(t('arrange.overwrite_confirm'");
    expect(save).toContain('samePanels(');
    expect(ru.arrange.overwrite_confirm).toContain('{{name}}');
  });

  test('a «no» keeps the typed name, so another one can be put in', () => {
    const saveAs = fn(arranger, 'saveAs');
    expect(saveAs).toContain('if (!editor.saveWorkspace(name))');
  });
});

// «Сохранено» says nothing until the first save: in arrange mode its handle
// was a 4px dashed sliver at the end of the row, which no hand could take.
describe('an item with nothing to say yet can still be picked up', () => {
  test('a wide handle is never narrower than a key', async () => {
    const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
    const rule = editorUi.match(/\.editor\.arranging \.arr\.wide \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('min-width: var(--key-h)');
  });
});
