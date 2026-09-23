import { describe, expect, it } from 'bun:test';
import {
  addFrame,
  addLayer,
  addStroke,
  copyCells,
  createDocument,
  insertFrameBefore,
  moveLayer,
  removeFrame,
  removeLayer,
  replaceCells,
} from '../model/operations';
import { copiedMarks, isFrameMarked, isMarked, lengthClock } from './frame-selection';

// The owner's answers after the twelfth audit. The pure parts run for real;
// EditorState and the Svelte markup are asserted as source, like
// owner-eleventh-*.test.ts.
const UI = new URL('./', import.meta.url).pathname;
const state = await Bun.file(UI + 'editor-state.svelte.ts').text();
const timeline = await Bun.file(UI + 'Timeline.svelte').text();
const panel = await Bun.file(UI + 'AudioPanel.svelte').text();

function member(source: string, name: string): string {
  const match = source.match(new RegExp(`\\n  (private )?(get )?${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

describe('lengths in the sound plate round to the second (owner: «округляй до секунды»)', () => {
  it('a one-frame film is never 0:00', () => {
    expect(lengthClock(1 / 12)).toBe('0:01');
    expect(lengthClock(0.4)).toBe('0:01');
  });

  it('rounds to the nearest second otherwise', () => {
    expect(lengthClock(1.4)).toBe('0:01');
    expect(lengthClock(1.5)).toBe('0:02');
    expect(lengthClock(59.6)).toBe('1:00');
    expect(lengthClock(125.2)).toBe('2:05');
  });

  it('only nothing at all reads as 0:00', () => {
    expect(lengthClock(0)).toBe('0:00');
    expect(lengthClock(Number.NaN)).toBe('0:00');
  });

  it('the plate says every length through it', () => {
    expect(panel).toContain('lengthClock(filmSeconds)');
    expect(panel).toContain('lengthClock(editor.audio.duration)');
    expect(panel).not.toContain('function clock(');
  });
});

/** Frames × layers, each cell holding one stroke whose x is `frame * 10 + layer`. */
function grid(frames: number, layers: number) {
  const doc = createDocument();
  for (let l = 1; l < layers; l++) addLayer(doc, l);
  for (let f = 1; f < frames; f++) addFrame(doc, f - 1);
  for (let l = 0; l < layers; l++) {
    for (let f = 0; f < frames; f++) addStroke(doc, l, f, { points: [f * 10 + l, 0], width: 8, color: '#000000' });
  }
  return doc;
}

const xOf = (doc: ReturnType<typeof grid>, l: number, f: number) => doc.layers[l].frames[f].strokes[0]?.points[0];

describe('the paste buffer is a snapshot of the copy', () => {
  it('a frame inserted in front of the block does not change what V pastes', () => {
    const doc = grid(4, 1);
    const buffer = copyCells(doc, { frames: [1, 2], layers: [0] });
    insertFrameBefore(doc, 0);
    replaceCells(doc, { frames: [0], layers: [0] }, buffer);
    expect(xOf(doc, 0, 0)).toBe(10);
  });
});

describe('the copied mark follows the cells, not their numbers', () => {
  it('marks the copied block', () => {
    const doc = grid(4, 2);
    const marks = copiedMarks(doc, { frames: [1, 2], layers: [1] });
    expect(isMarked(doc, marks, 1, 1)).toBe(true);
    expect(isMarked(doc, marks, 2, 1)).toBe(true);
    expect(isMarked(doc, marks, 1, 0)).toBe(false);
    expect(isFrameMarked(doc, marks, 0)).toBe(false);
    expect(isFrameMarked(doc, marks, 2)).toBe(true);
  });

  it('a frame inserted in front shifts the mark with the cells', () => {
    const doc = grid(4, 1);
    const marks = copiedMarks(doc, { frames: [1, 2], layers: [0] });
    insertFrameBefore(doc, 0);
    expect([0, 1, 2, 3, 4].filter((f) => isMarked(doc, marks, f, 0))).toEqual([2, 3]);
    expect([0, 1, 2, 3, 4].filter((f) => isFrameMarked(doc, marks, f))).toEqual([2, 3]);
  });

  it('a deleted frame takes its mark along; the rest of the block keeps it', () => {
    const doc = grid(4, 1);
    const marks = copiedMarks(doc, { frames: [1, 2], layers: [0] });
    removeFrame(doc, 1);
    expect([0, 1, 2].filter((f) => isMarked(doc, marks, f, 0))).toEqual([1]);
  });

  it('a layer added or moved carries the mark to its new row', () => {
    const doc = grid(2, 2);
    const marks = copiedMarks(doc, { frames: [0], layers: [0] });
    addLayer(doc, 0);
    expect(isMarked(doc, marks, 0, 0)).toBe(false);
    expect(isMarked(doc, marks, 0, 1)).toBe(true);
    moveLayer(doc, 1, 2);
    expect(isMarked(doc, marks, 0, 2)).toBe(true);
    expect(isMarked(doc, marks, 0, 1)).toBe(false);
  });

  it('a removed layer drops its marks', () => {
    const doc = grid(2, 2);
    const marks = copiedMarks(doc, { frames: [0, 1], layers: [1] });
    removeLayer(doc, 1);
    expect(isFrameMarked(doc, marks, 0)).toBe(false);
  });

  it('cells a paste writes over lose the mark: they hold something else now', () => {
    const doc = grid(2, 1);
    const marks = copiedMarks(doc, { frames: [0], layers: [0] });
    replaceCells(doc, { frames: [0], layers: [0] }, copyCells(doc, { frames: [1], layers: [0] }));
    expect(isMarked(doc, marks, 0, 0)).toBe(false);
  });
});

describe('the editor keeps the mark by cell', () => {
  it('copy records the cells themselves', () => {
    expect(member(state, 'copySelection')).toContain('copiedMarks(this.doc, this.selection)');
  });

  it('a stroke takes that cell out of the mark', () => {
    expect(member(state, 'commitStroke')).toContain('this.copiedMarks');
  });

  it('deleting every frame empties the first cell in place, so the mark goes too', () => {
    expect(member(state, 'removeActiveFrame')).toContain('this.copiedMarks = new Set()');
  });

  it('the strip asks by cell, the header by column', () => {
    expect(member(state, 'isCopiedCell')).toContain('isMarked(');
    expect(member(state, 'isCopiedFrame')).toContain('isFrameMarked(');
    expect(timeline).toContain('editor.isCopiedFrame(i)');
    expect(timeline).not.toContain('editor.copiedFrom');
    expect(state).not.toContain('copiedFrom');
    expect(state).not.toContain('copiedDrawnInto');
  });
});
