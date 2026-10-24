import { describe, expect, test } from 'bun:test';

import { addStroke, createDocument } from '../model/operations';
import type { ToonDocument } from '../format/types';
import { bakeTransform, type BakedTransform } from './bake-transform';
import { EMPTY_TRANSFORM, lassoCut } from './lasso';
import { copyPart, eraseSelected, pastePart } from './selection-clipboard';

// The owner, 2026-10-24: «добавь возможность копировать часть в кадре и
// вставлять в него же, также возможность удалить выделенное».

/** One horizontal line on layer 0, its middle taken by a loop. */
function middleTaken(): { doc: ToonDocument; open: BakedTransform } {
  const doc = createDocument();
  addStroke(doc, 0, 0, { points: [0, 0, 100, 0], width: 8, color: '#000000' });
  const cut = lassoCut(doc.layers[0].frames[0].strokes, [40, -10, 60, -10, 60, 10, 40, 10], doc.tools)!;
  return {
    doc,
    open: { layers: [0], box: { x: 40, y: 0, width: 20, height: 0 }, session: { ...EMPTY_TRANSFORM }, widthWithScale: false, picked: [cut] },
  };
}

describe('copyPart', () => {
  test('takes the piece inside the loop, as it stands now', () => {
    const { doc, open } = middleTaken();
    const part = copyPart(doc, 0, { ...open, session: { ...EMPTY_TRANSFORM, dy: 30 } });
    expect(part).toHaveLength(1);
    expect(part[0].layer).toBe(0);
    expect(part[0].strokes.map((s) => s.points)).toEqual([[40, 30, 60, 30]]);
    expect(part[0].strokes[0].tool).toMatchObject({ kind: 'pencil', width: 8, color: '#000000' });
  });

  test('a whole frame taken by Q is copied whole, the drawing untouched', () => {
    const doc = createDocument();
    addStroke(doc, 0, 0, { points: [0, 0, 100, 0], width: 8, color: '#000000' });
    addStroke(doc, 0, 0, { points: [0, 50, 100, 50], width: 8, color: '#ff0000' });
    const before = JSON.stringify(doc);
    const part = copyPart(doc, 0, { layers: [0], box: { x: 0, y: 0, width: 100, height: 50 }, session: { ...EMPTY_TRANSFORM }, widthWithScale: false });
    expect(part[0].strokes.map((s) => s.points)).toEqual([[0, 0, 100, 0], [0, 50, 100, 50]]);
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe('eraseSelected', () => {
  test('takes the piece inside the loop away and leaves the ends where they were', () => {
    const { doc, open } = middleTaken();
    eraseSelected(doc, 0, 0, open);
    expect(doc.layers[0].frames[0].strokes.map((s) => s.points)).toEqual([[0, 0, 40, 0], [60, 0, 100, 0]]);
  });

  test('a whole frame taken by Q is emptied', () => {
    const doc = createDocument();
    addStroke(doc, 0, 0, { points: [0, 0, 100, 0], width: 8, color: '#000000' });
    eraseSelected(doc, 0, 0, { layers: [0], box: { x: 0, y: 0, width: 100, height: 0 }, session: { ...EMPTY_TRANSFORM }, widthWithScale: false });
    expect(doc.layers[0].frames[0].strokes).toEqual([]);
  });
});

describe('pastePart', () => {
  test('the copy lands on top of the cell as the selection, moved down with the line left whole', () => {
    const { doc, open } = middleTaken();
    const part = copyPart(doc, 0, open);
    const before = JSON.stringify(doc.layers);
    const pasted = pastePart(doc, 0, part, (layer) => layer);
    expect(JSON.stringify(doc.layers)).toBe(before);
    const baked = bakeTransform(doc, 0, { ...pasted, box: { x: 40, y: 0, width: 20, height: 0 }, session: { ...EMPTY_TRANSFORM, dy: 30 }, widthWithScale: false });
    expect(baked.layers[0].frames[0].strokes.map((s) => s.points)).toEqual([[0, 0, 100, 0], [40, 30, 60, 30]]);
  });

  test('pasted and let go unmoved, it is still written', () => {
    const { doc, open } = middleTaken();
    const pasted = pastePart(doc, 0, copyPart(doc, 0, open), (layer) => layer);
    const baked = bakeTransform(doc, 0, { ...pasted, box: { x: 40, y: 0, width: 20, height: 0 }, session: { ...EMPTY_TRANSFORM }, widthWithScale: false });
    expect(baked.layers[0].frames[0].strokes.map((s) => s.points)).toEqual([[0, 0, 100, 0], [40, 0, 60, 0]]);
  });

  test('parts of two layers sent to one land together, in their order', () => {
    const doc = createDocument();
    addStroke(doc, 0, 0, { points: [0, 0, 10, 0], width: 8, color: '#000000' });
    const part = [
      { layer: 3, strokes: [{ points: [1, 1, 2, 2], tool: doc.tools[0] }] },
      { layer: 5, strokes: [{ points: [3, 3, 4, 4], tool: { ...doc.tools[0], color: '#00ff00' } as typeof doc.tools[0] }] },
    ];
    const pasted = pastePart(doc, 0, part, () => 0);
    expect(pasted.layers).toEqual([0]);
    expect(pasted.picked[0].indices).toEqual([1, 2]);
    expect(doc.tools[pasted.picked[0].strokes[2].tool_id]).toMatchObject({ color: '#00ff00' });
  });
});
