import { describe, expect, it } from 'bun:test';
import type { Frame, ToonDocument } from '../format/types';
import { stillStart, stills } from './stills';

const drawing = (x: number): Frame => ({ strokes: [{ points: [x, 0, x + 8, 0], tool_id: 0 }] });
/** A layer per string: a letter is a drawing, `.` a continuation. */
function film(...rows: string[]): ToonDocument {
  return {
    schema_version: 8,
    width: 64,
    height: 64,
    frame_rate: 12,
    tools: [{ kind: 'pencil', geometry: 'smooth', width: 8, color: '#000000' }],
    layers: rows.map((row) => ({
      hidden: false,
      frames: [...row].map((c) => (c === '.' ? null : drawing(c.charCodeAt(0)))),
    })),
  };
}
const letters = (doc: ToonDocument) =>
  doc.layers.map((layer) => layer.frames.map((f) => String.fromCharCode(f!.strokes[0].points[0])).join(''));

describe('the stills of a film', () => {
  it('fold a pause in every layer into one still that lasts its ticks', () => {
    const { film: still, holds, starts } = stills(film('A...B', 'a...b'));
    expect(letters(still)).toEqual(['AB', 'ab']);
    expect(holds).toEqual([4, 1]);
    expect(starts).toEqual([0, 4]);
  });

  it('cut where any layer changes', () => {
    const { film: still, holds } = stills(film('F....', 'ab.cd'));
    expect(letters(still)).toEqual(['FFFF', 'abcd']);
    expect(holds).toEqual([1, 2, 1, 1]);
  });

  it('leave a film of single ticks as it is, with no holds', () => {
    const { film: still, holds } = stills(film('ABC'));
    expect(letters(still)).toEqual(['ABC']);
    expect(holds).toBeUndefined();
  });

  it('has no continuations left', () => {
    expect(stills(film('A..', 'B.C')).film.layers.flatMap((l) => l.frames)).not.toContain(null);
  });
});

describe('the still a tick belongs to', () => {
  it('is the tick it begins on: a pause in every layer is one still', () => {
    const doc = film('A...B', 'a...b');
    expect([0, 1, 2, 3, 4].map((t) => stillStart(doc, t))).toEqual([0, 0, 0, 0, 4]);
  });

  it('begins anew where any layer changes', () => {
    const doc = film('F....', 'ab.cd');
    expect([0, 1, 2, 3, 4].map((t) => stillStart(doc, t))).toEqual([0, 1, 1, 3, 4]);
  });
});
