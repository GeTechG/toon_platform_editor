import { describe, expect, it } from 'bun:test';
import { addStroke, createDocument } from '../model/operations';
import { exportWidths } from '../export/rasterize';
import { resizeSheet, sheetChoices, sheetOf, sheetOpen, sheetProportions, sheetSizes, sheetValue } from './sheet-size';

// Размер листа выбирается в начале: 720p, 1080p, 2K, 4K, лёжа и стоя. Пока на
// листе ничего нет — его можно сменить; после первого штриха он закреплён.
// EditorState и Editor — на рунах: правило проверяется вызовом, обязанности
// компонентов — по исходнику.

const UI = new URL('./', import.meta.url).pathname;
const state = await Bun.file(UI + 'editor-state.svelte.ts').text();
const editorUi = await Bun.file(UI + 'Editor.svelte').text();

const line = { points: [0, 0, 80, 80], width: 40, color: '#000000' };

describe('листы, с которых можно начать', () => {
  it('16:9 — четыре размера, каждый лёжа и стоя', () => {
    expect(sheetChoices().filter((choice) => choice.proportion === '16:9').map((choice) => choice.value)).toEqual([
      '1280x720', '1920x1080', '2560x1440', '3840x2160',
      '720x1280', '1080x1920', '1440x2560', '2160x3840',
    ]);
  });

  // Владелец, 2026-10-05: карточка — пропорции, размер — по длинной стороне.
  it('четыре пропорции; размер — длинная сторона, короткая чётная', () => {
    expect(sheetProportions()).toEqual(['16:9', '4:3', '1:1', '21:9']);
    expect(sheetSizes()).toEqual(['720p', '1080p', '2K', '4K']);
    expect(sheetOf('4:3', '1080p', false).value).toBe('1920x1440');
    expect(sheetOf('21:9', '4K', false).value).toBe('3840x1646');
    expect(sheetOf('21:9', '720p', true).value).toBe('548x1280');
    expect(sheetOf('21:9', '720p', true).ratio).toBe('9:21');
  });

  it('квадрат один: стоя он тот же лист', () => {
    expect(sheetOf('1:1', '2K', true)).toEqual(sheetOf('1:1', '2K', false));
    const values = sheetChoices().map((choice) => choice.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values.length).toBe(28);
  });

  it('каждый — документ, который формат принимает', () => {
    for (const choice of sheetChoices()) {
      expect(() => createDocument({ width: choice.width * 8, height: choice.height * 8 })).not.toThrow();
    }
  });

  it('новый документ — первый из них', () => {
    expect(sheetValue(createDocument())).toBe(sheetChoices()[0].value);
  });
});

describe('размер меняется, пока лист пуст', () => {
  it('пустой лист без истории открыт', () => {
    expect(sheetOpen(createDocument(), 0)).toBe(true);
  });

  it('первый штрих закрепляет размер', () => {
    const doc = createDocument();
    addStroke(doc, 0, 0, line);
    expect(sheetOpen(doc, 0)).toBe(false);
  });

  it('отменённый штрих лист не открывает: повтор вернул бы линию другого листа', () => {
    expect(sheetOpen(createDocument(), 1)).toBe(false);
  });

  it('выбор ставит документу логический размер в его единицах', () => {
    const doc = createDocument();
    resizeSheet(doc, '2160x3840');
    expect([doc.width, doc.height]).toEqual([17280, 30720]);
    expect(sheetValue(doc)).toBe('2160x3840');
  });

  it('размера не из списка лист не берёт', () => {
    const doc = createDocument();
    resizeSheet(doc, '99999x1');
    expect([doc.width, doc.height]).toEqual([10240, 5760]);
  });

  it('состояние меняет размер только у открытого листа и считает историю', () => {
    const set = state.match(/\n  setSheet\([^]*?\n  }/)![0];
    expect(set).toMatch(/if \(!this\.sheetOpen\) \{\s*return;/);
    const open = state.match(/\n  get sheetOpen\(\)[^]*?\n  }/)![0];
    expect(open).toContain('this.edits.length');
    expect(open).toContain('this.undone.length');
  });

  // Владелец, 2026-10-05: выбор разрешения с холста убран — лист выбирается в
  // хабе, на экране «Новый мульт».
  it('на сцене выбора листа нет: он в хабе', async () => {
    expect(editorUi).not.toContain('sheet-size"');
    expect(editorUi).not.toContain('.sheet-size');
    expect(editorUi).not.toMatch(/<select[^>]*>\s*\{#each [^}]*sheetChoices/);
    const hub = await Bun.file(UI + 'DraftsHub.svelte').text();
    expect(hub).toContain('onSheet(value)');
  });
});

describe('экспорт предлагает лист в его собственном размере', () => {
  const doc = (w: number, h: number) => createDocument({ width: w * 8, height: h * 8 });

  it('лист 4K — ряд и 3840', () => {
    expect(exportWidths(doc(3840, 2160))).toEqual([640, 1280, 1920, 2560, 3840]);
  });

  it('стоячий 1080p — 1080 среди ряда, по порядку', () => {
    expect(exportWidths(doc(1080, 1920))).toEqual([640, 1080, 1280, 1920, 2560]);
  });

  it('лист 720p — ряд как был', () => {
    expect(exportWidths(doc(1280, 720))).toEqual([640, 1280, 1920, 2560]);
  });
});
