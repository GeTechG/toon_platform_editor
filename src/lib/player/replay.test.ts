import { describe, expect, it } from 'bun:test';
import type { Stroke, ToonDocument } from '../format/types';
import { playLength, REPLAY_FPS, replayAt, replayEnded, replayStart } from './replay';

// A one-frame publication is a drawing, and a drawing that stands still in a
// player looks broken. So it is replayed the way it was drawn: stroke by
// stroke, the bottom layer first, a tenth of a second each (the owner,
// 2026-10-06).
const s = (n: number) => ({ tool: 0, points: [n, n] }) as unknown as Stroke;
const doc = (layers: Array<{ hidden?: boolean; frames: number[][] }>): ToonDocument =>
  ({
    schema_version: 7,
    width: 640,
    height: 320,
    frame_rate: 12,
    tools: [],
    layers: layers.map((l) => ({ hidden: l.hidden ?? false, frames: l.frames.map((f) => ({ strokes: f.map(s) })) })),
  }) as ToonDocument;
const shown = (d: ToonDocument) => d.layers.map((l) => l.frames[0].strokes.map((x) => x.points[0]));

describe('how long a publication plays', () => {
  it('an animation plays its own frames at its own rate', () => {
    expect(playLength(doc([{ frames: [[1], [2], [3]] }]))).toEqual({ frames: 3, fps: 12, replay: false });
  });

  it('a one-frame drawing plays a step per stroke at ten a second', () => {
    const d = doc([{ frames: [[1, 2]] }, { frames: [[3]] }]);
    expect(REPLAY_FPS).toBe(10);
    expect(playLength(d)).toEqual({ frames: 3, fps: 10, replay: true });
  });

  it('a hidden layer takes no time: nothing of it is ever seen', () => {
    const d = doc([{ frames: [[1, 2]] }, { hidden: true, frames: [[3, 4, 5]] }]);
    expect(playLength(d).frames).toBe(2);
  });

  it('one stroke is not a replay', () => {
    expect(playLength(doc([{ frames: [[1]] }]))).toEqual({ frames: 1, fps: 12, replay: false });
  });
});

describe('the drawing at a step', () => {
  const d = doc([{ frames: [[1, 2]] }, { hidden: true, frames: [[9]] }, { frames: [[3, 4]] }]);

  it('grows from the bottom layer up, one stroke a step', () => {
    expect(shown(replayAt(d, 0))).toEqual([[1], [9], []]);
    expect(shown(replayAt(d, 1))).toEqual([[1, 2], [9], []]);
    expect(shown(replayAt(d, 2))).toEqual([[1, 2], [9], [3]]);
    expect(shown(replayAt(d, 3))).toEqual([[1, 2], [9], [3, 4]]);
  });

  it('is whole on its last step', () => {
    expect(shown(replayAt(d, playLength(d).frames - 1))).toEqual([[1, 2], [9], [3, 4]]);
  });

  it('leaves the document it was given alone', () => {
    replayAt(d, 0);
    expect(shown(d)).toEqual([[1, 2], [9], [3, 4]]);
  });
});

// The owner, 2026-10-06: a drawing rests finished, is drawn once on a press of
// play, and stays finished — it does not loop.
describe('a replay is played once', () => {
  it('starts over when play is pressed on the finished drawing', () => {
    expect(replayStart(4, 5)).toBe(0);
  });

  it('goes on from where the line was dragged to', () => {
    expect(replayStart(2, 5)).toBe(2);
  });

  it('ends on the last step', () => {
    expect(replayEnded(3, 4, 5)).toBe(true);
    expect(replayEnded(2, 3, 5)).toBe(false);
  });

  it('ends when a slow tab skips the last step and the clock comes round', () => {
    expect(replayEnded(3, 0, 5)).toBe(true);
  });
});
