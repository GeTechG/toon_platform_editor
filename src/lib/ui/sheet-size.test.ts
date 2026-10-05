import { describe, expect, it } from 'bun:test';
import { addStroke, createDocument } from '../model/operations';
import { exportWidths } from '../export/rasterize';
import { resizeSheet, sheetChoices, sheetOpen, sheetValue } from './sheet-size';

// Размер листа выбирается в начале: 720p, 1080p, 2K, 4K, лёжа и стоя. Пока на
// листе ничего нет — его можно сменить; после первого штриха он закреплён.
// EditorState и Editor — на рунах: правило проверяется вызовом, обязанности
// компонентов — по исходнику.

const UI = new URL('./', import.meta.url).pathname;
const state = await Bun.file(UI + 'editor-state.svelte.ts').text();
const editorUi = await Bun.file(UI + 'Editor.svelte').text();

const line = { points: [0, 0, 80, 80], width: 40, color: '#000000' };

describe('листы, с которых можно начать', () => {
  it('четыре размера, каждый лёжа и стоя', () => {
    expect(sheetChoices().map((choice) => choice.value)).toEqual([
      '1280x720', '1920x1080', '2560x1440', '3840x2160',
      '720x1280', '1080x1920', '1440x2560', '2160x3840',
    ]);
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

  it('выбор стоит на сцене, только пока лист открыт, и это один родной список', () => {
    const shown = editorUi.match(/\{#if editor\.sheetOpen\}[^]*?\{\/if\}/)?.[0] ?? '';
    expect(shown).toContain('<select');
    expect(shown).toContain('editor.setSheet(');
    expect(shown).toContain("t('sheet.size')");
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
