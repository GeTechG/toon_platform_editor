import { describe, expect, it } from 'bun:test';
import { addLayer, addStroke, createDocument, moveLayer } from '../model/operations';
import { cutText, MAX_LAYER_NAME, cutLayerName } from '../format/constants';
import { restoreStructure, structureIntact, takeStructure } from './structure-undo';
import { defaultPanels } from './panels';
import {
  MAX_WORKSPACE_NAME,
  exportWorkspace,
  importWorkspaces,
  parseWorkspaces,
  withWorkspace,
  workspaceConflicts,
  workspaceName,
} from './workspaces';

// Ответы владельца после 14-го аудита, лента слоёв и раскладки.
// 1. Перенос слоя (перетаскивание строки, Alt+↑/↓) отменяется Z и
//    возвращается повтором. Перенос — структура, а не рисование: на скрытом
//    активном слое он работает, как добавление и удаление.
// 2. Имя раскладки — не длиннее 40 знаков: поле «название», файл раскладок и
//    хранилище; совпавшие после обрезки имена спрашивают о замене.
const UI = new URL('./', import.meta.url).pathname;
const state = await Bun.file(UI + 'editor-state.svelte.ts').text();
const rows = await Bun.file(UI + 'LayerRows.svelte').text();
const arranger = await Bun.file(UI + 'PanelArranger.svelte').text();

function member(source: string, name: string): string {
  const match = source.match(new RegExp(`\\n  (private )?(get )?${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

/** Три слоя, в каждом по штриху с номером слоя по x. */
function layered() {
  const doc = createDocument();
  addLayer(doc, 1);
  addLayer(doc, 2);
  for (let l = 0; l < 3; l++) addStroke(doc, l, 0, { points: [l, 0], width: 8, color: '#000000' });
  return doc;
}
const order = (doc: ReturnType<typeof layered>) => doc.layers.map((l) => l.frames[0].strokes[0].points[0]);

describe('перенос слоя отменяется и возвращается', () => {
  it('снимок до переноса возвращает порядок, снимок после — повторяет его', () => {
    const doc = layered();
    const before = takeStructure(doc);
    moveLayer(doc, 0, 2);
    before.seal(doc);
    const after = takeStructure(doc);
    after.seal(doc);
    expect(order(doc)).toEqual([1, 2, 0]);
    expect(structureIntact(doc, before)).toBe(true);

    restoreStructure(doc, before);
    expect(order(doc)).toEqual([0, 1, 2]);

    restoreStructure(doc, after);
    expect(order(doc)).toEqual([1, 2, 0]);
    // Шаг снова лежит в истории: документ ровно тот, что перенос оставил.
    expect(structureIntact(doc, before)).toBe(true);
  });

  it('moveLayerTo кладёт шаг структуры в историю', () => {
    const move = member(state, 'moveLayerTo');
    expect(move).toContain('this.takeStructure()');
    expect(move).toContain('this.pushStructure(');
    // Перенос — структура: скрытый слой его не запрещает.
    expect(move).not.toContain('mayEdit');
  });

  it('перетаскивание строки — один шаг, а отмена жеста не оставляет шага', () => {
    const move = member(state, 'moveLayerTo');
    expect(move).toMatch(/moveLayerTo\(from: number, to: number, merge = false\)/);
    expect(rows).toMatch(/editor\.moveLayerTo\(drag\.currentLayer, targetLayer, drag\.currentLayer !== drag\.fromLayer\)/);
    expect(rows).toMatch(/editor\.moveLayerTo\(drag\.currentLayer, drag\.fromLayer, true\)/);
  });

  it('повтор возвращает перенос раньше проверки скрытого слоя', () => {
    const redo = member(state, 'redo');
    const structure = redo.indexOf('this.redoableStructure');
    expect(structure).toBeGreaterThan(-1);
    expect(structure).toBeLessThan(redo.indexOf('mayEdit'));
    expect(member(state, 'canRedo')).toContain('this.redoableStructure');
  });

  it('отмена и повтор возвращают активный слой и говорят читалке, где слой', () => {
    const undo = member(state, 'undo');
    expect(undo).toContain('this.activeLayer = structure.activeLayer');
    expect(undo).toContain('this.layerMoved =');
    expect(member(state, 'redo')).toContain('this.layerMoved =');
    expect(rows).toMatch(/editor\.layerMoved[^]*announce\(/);
  });
});

describe('имя раскладки не длиннее 40 знаков', () => {
  it('обрезка не рвёт суррогатную пару', () => {
    expect(MAX_WORKSPACE_NAME).toBe(40);
    const name = 'а'.repeat(39) + '😀хвост';
    expect(cutText(name, 40)).toBe('а'.repeat(39));
    expect(cutText('коротко', 40)).toBe('коротко');
    // Имя слоя режется тем же правилом.
    expect(cutLayerName('б'.repeat(11) + '😀')).toBe(cutText('б'.repeat(11) + '😀', MAX_LAYER_NAME));
  });

  it('имя без пробелов по краям и после обрезки', () => {
    expect(workspaceName('  ' + 'я'.repeat(39) + ' хвост')).toBe('я'.repeat(39));
  });

  it('поле «название» принимает не больше 40', () => {
    expect(arranger).toMatch(/class="ws-name"[^>]*maxlength=\{MAX_WORKSPACE_NAME\}/);
  });

  it('хранилище и файл отдают обрезанные имена', () => {
    const long = 'Стол'.repeat(20);
    const raw = JSON.stringify([{ id: 1, name: long, panels: defaultPanels(), floatPos: {} }]);
    expect(parseWorkspaces(raw)[0].name).toBe(long.slice(0, 40));
    expect(importWorkspaces([], raw).workspaces[0].name).toHaveLength(40);
  });

  it('совпавшее после обрезки имя спрашивает о замене', () => {
    const base = 'Р'.repeat(40);
    const mine = withWorkspace([], base, defaultPanels(), {});
    const other = defaultPanels();
    other.hidden = [...other.hidden, other.left[0]];
    other.left = other.left.slice(1);
    const raw = exportWorkspace(base + ' другой', other, {});
    expect(workspaceConflicts(mine, raw)).toEqual([base]);
  });

  it('«Сохранить» режет имя тем же правилом', () => {
    expect(member(state, 'saveWorkspace')).toContain('workspaceName(');
    expect(arranger).toContain('workspaceName(newName)');
  });
});
