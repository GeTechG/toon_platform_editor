import { describe, expect, it } from 'bun:test';
import { SQUARE_STAMP } from '../format/types';
import type { Stroke, ToolDescriptor } from '../format/types';
import { editCells } from '../plugins/host';
import { t } from '../i18n';
import { keyOwner, type KeyPress } from './key-owner';
import { pickerFirstFocus, pickerKeyAction } from './picker-model';
import { toolKeyList } from './panels';
import { keyPan, type Stage } from './viewport';
import { createSideButtonGuard } from './side-buttons';

// Ответы владельца после четырнадцатого аудита, холст и окно цвета:
// 1. Поле в окне цвета подписано «Цвет», а не «HEX», и читалке сказано, что
//    оно принимает — hex, rgb(), hsl(), oklch(), hwb(), lab() и названия.
// 2. Окно цвета открывается с фокусом на поле цвета, не на «Закрыть».
// 3. У лассо две клавиши (Q и S), у руки две (D и O) — подсказки называют обе.
// 4. Лист, не влезающий в стол, панорамируется с клавиатуры.
// 5. Боковые кнопки мыши рисуют, но не листают историю браузера.
// 6. Дрожь прижимает пиксельные штрихи к сетке клеток.
const UI = new URL('./', import.meta.url).pathname;
const picker = await Bun.file(UI + 'ColourPicker.svelte').text();
const toolKey = await Bun.file(UI + 'ToolKey.svelte').text();
const editorUi = await Bun.file(UI + 'Editor.svelte').text();
const canvas = await Bun.file(UI + 'CanvasView.svelte').text();
const ru = JSON.parse(await Bun.file(UI + '../i18n/ru.json').text());

describe('поле в окне цвета называет то, что принимает', () => {
  it('подпись — «Цвет», а не «HEX»', () => {
    expect(picker).not.toContain('<span>HEX</span>');
    expect(ru.picker.text).toBe('Цвет');
    expect(picker).toContain("t('picker.text')");
  });

  it('читалке сказано, какие записи цвета поле читает', () => {
    const hint = t('picker.text_formats');
    for (const format of ['hex', 'rgb()', 'hsl()', 'oklch()', 'hwb()', 'lab()']) {
      expect(hint).toContain(format);
    }
    expect(hint).toContain('назван');
    expect(picker).toContain('aria-describedby=');
    expect(picker).toContain("t('picker.text_formats')");
  });
});

describe('окно цвета открывается на поле цвета, а не на «Закрыть»', () => {
  it('мышь и клавиатура — поле ввода цвета', () => {
    expect(pickerFirstFocus(false)).toBe('text');
  });

  it('палец — поле-ползунок: текстовое поле подняло бы клавиатуру само', () => {
    expect(pickerFirstFocus(true)).toBe('field');
  });

  it('окно ставит этот фокус сразу после открытия, по грубому указателю', () => {
    expect(picker).toContain('pickerFirstFocus(');
    expect(picker).toContain("matchMedia('(pointer: coarse)')");
  });

  it('зажатый Enter, что открыл окно, не закрывает его повтором', () => {
    expect(pickerKeyAction('Enter', 'INPUT', true)).toBe('swallow');
    expect(pickerKeyAction('Enter', 'BUTTON', true)).toBe('swallow');
    expect(pickerKeyAction('Enter', 'INPUT')).toBe('commit');
    expect(picker).toContain('e.repeat');
  });
});

describe('у лассо и у руки по две клавиши, и подсказки называют обе', () => {
  it('рука — D и O, лассо — Q и S', () => {
    expect(toolKeyList('drag')).toEqual(['D', 'O']);
    expect(toolKeyList('lasso')).toEqual(['Q', 'S']);
    expect(toolKeyList('pencil')).toEqual(['B']);
  });

  it('заголовки инструментов называют обе клавиши', () => {
    expect(t('tool.hand.title')).toContain('D или O');
    expect(t('tool.transform.title')).toContain('Q или S');
  });

  it('кнопка инструмента отдаёт обе клавиши и в data-key, и в aria-keyshortcuts', () => {
    expect(toolKey).toContain('toolKeyList(tool)');
    expect(toolKey).toContain("aria-keyshortcuts={keys.join(' ') || undefined}");
    expect(toolKey).toContain("data-key={keys.join(' / ') || undefined}");
  });
});

describe('лист, не влезающий в стол, двигается с клавиатуры', () => {
  const stage: Stage = { width: 800, height: 600, sheetWidth: 640, sheetHeight: 360 };
  const press = (key: string, extra: Partial<KeyPress> & { shiftKey?: boolean } = {}): 'editor' | 'control' =>
    keyOwner({
      key,
      target: null,
      defaultPrevented: false,
      ctrlKey: true,
      metaKey: false,
      modalOpen: false,
      letterKeys: true,
      shiftKey: true,
      ...extra,
    });

  it('Ctrl+Shift+стрелки — студии: Shift+стрелки уже ведут выделение кадров и сдвиг трансформации', () => {
    expect(press('ArrowLeft')).toBe('editor');
    expect(press('ArrowDown')).toBe('editor');
    // Ctrl без Shift по-прежнему браузера.
    expect(press('ArrowLeft', { shiftKey: false })).toBe('control');
  });

  it('в текстовом поле Ctrl+Shift+стрелки остаются выделением слов', () => {
    const field = {
      tagName: 'INPUT',
      isContentEditable: false,
      getAttribute: (name: string) => (name === 'type' ? 'text' : null),
      matches: () => false,
    };
    expect(press('ArrowLeft', { target: field })).toBe('control');
  });

  it('при вписанном листе вид не двигается', () => {
    const view = { zoom: 1, panX: 80, panY: 120 };
    expect(keyPan(view, stage, 'ArrowLeft')).toBe(view);
  });

  it('увеличенный лист сдвигается на десятую часть стола', () => {
    const view = { zoom: 2, panX: -200, panY: -100 };
    // Стрелка вправо — посмотреть правее, лист уезжает влево.
    expect(keyPan(view, stage, 'ArrowRight')).toEqual({ zoom: 2, panX: -280, panY: -100 });
    expect(keyPan(view, stage, 'ArrowUp')).toEqual({ zoom: 2, panX: -200, panY: -40 });
  });

  it('границы — как у панорамы мышью: лист не теряется со стола', () => {
    const view = { zoom: 2, panX: 800 - 64, panY: 0 };
    expect(keyPan(view, stage, 'ArrowLeft').panX).toBe(800 - 64);
  });

  it('студия зовёт это правило, и мануал называет сочетание', () => {
    expect(editorUi).toContain('keyPan(');
    expect(ru.key.pan_sheet).toBeTruthy();
    expect(editorUi).toContain("['Ctrl + Shift + ←→↑↓', t('key.pan_sheet')]");
  });
});

describe('боковые кнопки мыши не листают историю, если нажаты на холсте', () => {
  const event = (type: string, button: number) => {
    const e = { type, button, prevented: false, preventDefault() { e.prevented = true; } };
    return e;
  };

  it('отпускание четвёртой и пятой кнопки после нажатия на холсте гасится', () => {
    const later: (() => void)[] = [];
    const guard = createSideButtonGuard((run) => later.push(run));
    guard.press(3);
    const up = event('mouseup', 3);
    const pointerUp = event('pointerup', 3);
    const aux = event('auxclick', 3);
    guard.release(pointerUp);
    guard.release(up);
    guard.release(aux);
    expect([pointerUp.prevented, up.prevented, aux.prevented]).toEqual([true, true, true]);
  });

  it('после отпускания страж снят: боковая кнопка вне холста листает как обычно', () => {
    const later: (() => void)[] = [];
    const guard = createSideButtonGuard((run) => later.push(run));
    guard.press(4);
    guard.release(event('mouseup', 4));
    later.forEach((run) => run());
    const next = event('mouseup', 4);
    guard.release(next);
    expect(next.prevented).toBe(false);
  });

  it('левая, средняя и правая кнопки не трогаются', () => {
    const guard = createSideButtonGuard(() => {});
    guard.press(0);
    const up = event('mouseup', 0);
    guard.release(up);
    expect(up.prevented).toBe(false);
  });

  it('холст ставит страж на нажатие и слушает отпускание на всём окне', () => {
    expect(canvas).toContain('createSideButtonGuard(');
    expect(canvas).toContain('sideButtons.press(e.button)');
    expect(canvas).toContain("['pointerup', 'mouseup', 'auxclick']");
    expect(canvas).toContain('window.addEventListener(kind, sideButtons.release, { capture: true })');
    expect(canvas).toContain('window.removeEventListener(kind, sideButtons.release, { capture: true })');
  });
});

describe('дрожь прижимает пиксельные штрихи к сетке клеток', () => {
  const pixel: ToolDescriptor = { kind: 'stamp', geometry: 'line', width: 20, color: '#000000', shape: [...SQUARE_STAMP] };
  const line = { kind: 'pencil', geometry: 'line', width: 9, color: '#000000' } as unknown as ToolDescriptor;

  it('клетка, сдвинутая плагином на полклетки с лишним, ложится в соседнюю клетку', () => {
    const cell = { strokes: [{ points: [40, 60, 60, 60], tool_id: 0 } as Stroke] };
    const [[out]] = editCells([cell], (strokes) => {
      strokes[0].points = [53, 47, 67, 73];
    }, [pixel]);
    expect(out.points).toEqual([60, 40, 60, 80]);
  });

  it('обычная линия остаётся там, куда её сдвинули', () => {
    const cell = { strokes: [{ points: [40, 60, 60, 60], tool_id: 0 } as Stroke] };
    const [[out]] = editCells([cell], (strokes) => {
      strokes[0].points = [53, 47, 67, 73];
    }, [line]);
    expect(out.points).toEqual([53, 47, 67, 73]);
  });
});
