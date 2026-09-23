import { describe, expect, it } from 'bun:test';
import { addFrame, addLayer, addStroke, createDocument, removeFrame, removeLayer } from '../model/operations';
import { restoreStructure, structureIntact, takeStructure } from './structure-undo';

// Владелец после одиннадцатого аудита: удаление кадров и слоёв отменяется.
// Снимок — ссылки на слои, массивы кадров и число штрихов; отмена ставит их
// на место, пока рисунок в том виде, в каком его оставило удаление.

function doc(frames: number, layers = 1) {
  const d = createDocument();
  for (let i = 1; i < frames; i++) addFrame(d, i - 1);
  for (let l = 1; l < layers; l++) addLayer(d, l);
  for (let l = 0; l < layers; l++) {
    for (let i = 0; i < frames; i++) addStroke(d, l, i, { points: [i, l], width: 8, color: '#000000' });
  }
  return d;
}
const xs = (d: ReturnType<typeof doc>, l = 0) => d.layers[l].frames.map((f) => f.strokes[0]?.points[0]);

describe('отмена удаления', () => {
  it('возвращает удалённый блок кадров на место', () => {
    const d = doc(6, 2);
    const snap = takeStructure(d);
    removeFrame(d, 1, 3);
    snap.seal(d);
    expect(structureIntact(d, snap)).toBe(true);
    restoreStructure(d, snap);
    expect(xs(d)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(xs(d, 1)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('возвращает штрихи первого кадра, когда удалили все', () => {
    const d = doc(3);
    const snap = takeStructure(d);
    removeFrame(d, 0, 3);
    snap.seal(d);
    restoreStructure(d, snap);
    expect(xs(d)).toEqual([0, 1, 2]);
  });

  it('возвращает удалённый слой с его рисунком', () => {
    const d = doc(2, 3);
    d.layers[1].name = 'Фон';
    const snap = takeStructure(d);
    removeLayer(d, 1);
    snap.seal(d);
    restoreStructure(d, snap);
    expect(d.layers).toHaveLength(3);
    expect(d.layers[1].name).toBe('Фон');
    expect(xs(d, 1)).toEqual([0, 1]);
  });

  it('штрих поверх удаления ждёт своей отмены первым', () => {
    const d = doc(4);
    const snap = takeStructure(d);
    removeFrame(d, 1);
    snap.seal(d);
    addStroke(d, 0, 0, { points: [9, 9], width: 8, color: '#000000' });
    expect(structureIntact(d, snap)).toBe(false);
    d.layers[0].frames[0].strokes.pop();
    expect(structureIntact(d, snap)).toBe(true);
  });

  it('новый кадр после удаления закрывает отмену', () => {
    const d = doc(4);
    const snap = takeStructure(d);
    removeFrame(d, 1);
    snap.seal(d);
    addFrame(d, 0);
    expect(structureIntact(d, snap)).toBe(false);
  });
});

const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();

describe('редактор', () => {
  it('удаление кадров и слоя кладёт снимок в историю', () => {
    expect(state).toMatch(/removeActiveFrame\(\)[^]*?takeStructure\([^]*?pushStructure\(/);
    expect(state).toMatch(/removeActiveLayer\(\)[^]*?takeStructure\([^]*?pushStructure\(/);
  });

  it('отмена сначала смотрит на снимок структуры', () => {
    expect(state).toMatch(/undo\(\): void \{[^]*?restorableStructure[^]*?restorableEdit/);
  });
});
