import { describe, expect, it } from 'bun:test';
import { eraseStrokes } from './mega-eraser';

const line = (points: number[], tool_id = 0) => ({ points, tool_id });

describe('eraseStrokes', () => {
  it('leaves a stroke the gesture never reaches untouched', () => {
    const strokes = [line([0, 0, 100, 0])];
    expect(eraseStrokes(strokes, [0, 500, 100, 500], 10)).toEqual(strokes);
  });

  it('cuts a stroke in two where the capsule crosses it, keeping the tool', () => {
    const result = eraseStrokes([line([0, 0, 100, 0], 3)], [50, -50, 50, 50], 10);
    expect(result).toHaveLength(2);
    expect(result.every((piece) => piece.tool_id === 3)).toBe(true);
    const [left, right] = result;
    expect(left.points[0]).toBe(0);
    expect(left.points.at(-2)).toBeCloseTo(40, 0);
    expect(right.points[0]).toBeCloseTo(60, 0);
    expect(right.points.at(-2)).toBe(100);
  });

  it('trims a stroke whose end lies inside the capsule', () => {
    const result = eraseStrokes([line([0, 0, 100, 0])], [100, -50, 100, 50], 20);
    expect(result).toHaveLength(1);
    expect(result[0].points[0]).toBe(0);
    expect(result[0].points.at(-2)).toBeCloseTo(80, 0);
  });

  it('drops a stroke that lies entirely inside the capsule', () => {
    expect(eraseStrokes([line([0, 0, 40, 0])], [-10, 0, 50, 0], 30)).toEqual([]);
  });

  it('drops a dot inside the capsule and keeps one outside', () => {
    expect(eraseStrokes([line([0, 0]), line([200, 0])], [0, 0, 10, 0], 20)).toEqual([line([200, 0])]);
  });

  it('keeps integer coordinates — the format has no room for anything else', () => {
    const result = eraseStrokes([line([0, 0, 100, 3])], [50, -50, 50, 50], 7);
    for (const piece of result) {
      expect(piece.points.every(Number.isInteger)).toBe(true);
    }
  });

  it('erases nothing for an empty gesture', () => {
    const strokes = [line([0, 0, 100, 0])];
    expect(eraseStrokes(strokes, [], 10)).toEqual(strokes);
  });
});
