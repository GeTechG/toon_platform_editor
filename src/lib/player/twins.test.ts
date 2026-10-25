import { describe, expect, it } from 'bun:test';
import { frameTwins } from './twins';
import type { ToonDocument } from '../format/types';

// Удержание кадра копией — тот же рисунок в соседних кадрах. Плеер растеризует
// его один раз: каждый кадр знает первый, что выглядит так же.

const line = (x: number) => ({ tool_id: 0, points: [x, 0, 8, 8] });
const film = (layers: { hidden?: boolean; frames: { strokes: unknown[] }[] }[]) =>
  ({ layers: layers.map((layer, i) => ({ name: String(i), ...layer })) }) as unknown as ToonDocument;

describe('двойники кадров', () => {
  it('кадр-копия указывает на первый такой же', () => {
    const doc = film([{ frames: [{ strokes: [line(1)] }, { strokes: [line(1)] }, { strokes: [line(2)] }, { strokes: [line(1)] }] }]);
    expect(frameTwins(doc)).toEqual([0, 0, 2, 0]);
  });

  it('кадр одинаков, только если одинаковы все видимые слои', () => {
    const doc = film([
      { frames: [{ strokes: [line(1)] }, { strokes: [line(1)] }, { strokes: [line(1)] }] },
      { frames: [{ strokes: [line(5)] }, { strokes: [line(6)] }, { strokes: [line(5)] }] },
    ]);
    expect(frameTwins(doc)).toEqual([0, 1, 0]);
  });

  it('скрытый слой не различает кадры', () => {
    const doc = film([
      { frames: [{ strokes: [line(1)] }, { strokes: [line(1)] }] },
      { hidden: true, frames: [{ strokes: [line(5)] }, { strokes: [line(6)] }] },
    ]);
    expect(frameTwins(doc)).toEqual([0, 0]);
  });

  it('штрихи в другом порядке — другой кадр: верхний ложится поверх', () => {
    const doc = film([{ frames: [{ strokes: [line(1), line(2)] }, { strokes: [line(2), line(1)] }] }]);
    expect(frameTwins(doc)).toEqual([0, 1]);
  });
});
