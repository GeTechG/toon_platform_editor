import { describe, expect, it } from 'bun:test';

// Owner's answer after the sixteenth audit: a layer is renamed on a phone and
// a tablet too. A double tap is not a dblclick on iOS (it zooms), and F2 needs
// a keyboard, so a held finger or pen on the row opens the name field.
// Checked by the source, as the other runes components are.
const UI = new URL('./', import.meta.url).pathname;
const rows = await Bun.file(UI + 'LayerRows.svelte').text();
const ru = await Bun.file(UI + '../i18n/ru.json').json();

/** Тело функции из исходника компонента, до закрывающей скобки. */
function fn(source: string, name: string): string {
  return source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n  }`))?.[0] ?? '';
}

describe('после шестнадцатого аудита: удержание на строке слоя — переименовать', () => {
  it('палец и перо, не мышь: у мыши есть двойной клик', () => {
    const body = fn(rows, 'onRowDown');
    expect(body).toMatch(/pointerType === 'mouse'/);
    expect(body).toMatch(/setTimeout\(/);
    expect(rows).toMatch(/onpointerdown=\{\(e\) => onRowDown\(e, layerIndex\)\}/);
  });

  it('клавиши строки (глаз, цвет, ручка, корзина) удержанием не переименовывают', () => {
    expect(fn(rows, 'onRowDown')).toMatch(/closest\('button:not\(\.name\), \.handle'\)/);
  });

  it('поле открывается на отпускании, внутри жеста: iOS не даёт клавиатуру фокусу из таймера', () => {
    const up = fn(rows, 'onRowUp');
    expect(up).toMatch(/flushSync\(/);
    expect(up).toMatch(/\.rename'\)\?\.focus\(\)/);
    expect(up.indexOf('startRename')).toBeLessThan(up.indexOf('flushSync'));
  });

  it('прокрутка списка или уход пальца отменяют удержание', () => {
    for (const event of ['onpointercancel', 'onpointerleave']) {
      expect(rows).toMatch(new RegExp(`${event}=\\{cancelRowHold\\}`));
    }
  });

  it('удержание не зовёт системное меню iOS', () => {
    expect(rows).toMatch(/\.row \{[^}]*-webkit-touch-callout: none;/);
  });

  it('подсказка называет удержание', () => {
    expect(ru.layer.rename_hint).toMatch(/удерж/i);
  });
});
