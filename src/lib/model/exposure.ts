/**
 * The time of a layer: operations on the cells of one layer (or of the layers
 * of a block) that leave every other layer as it stands. A layer's cells are
 * drawings and continuations (`null`, see `cells.ts`); a drawing lasts from
 * its cell to the next drawing of its layer.
 *
 * The rule of the shift (design, timeline-exposure-cells): a layer whose tail
 * is pushed right eats a continuation at its end, if the drawing it continues
 * was pushed too; otherwise the film grows by a cell and every other layer
 * continues into it. So the film does not grow on its own, and no drawing is
 * lost off its end.
 */

import { MAX_FRAMES } from '../format/constants';
import type { Cell, Frame, ToonDocument } from '../format/types';
import { keyOf } from './cells';

/** Film length — every layer has as many cells. */
function length(doc: ToonDocument): number {
  return doc.layers[0].frames.length;
}

/**
 * Puts `cells` into each of `layers` at `at`, pushing the tail right by the
 * rule of the shift. Returns the film's length after.
 */
export function insertCells(doc: ToonDocument, layers: readonly number[], at: number, cells: readonly Cell[]): number {
  const n = cells.length;
  for (const l of layers) {
    const frames = doc.layers[l].frames;
    frames.splice(at, 0, ...cells.map((cell) => (cell ? structuredClone(cell) : null)));
    eatTail(frames, at + n, n);
  }
  return evenOut(doc);
}

/**
 * Takes up to `n` continuations off the end of a layer, when the drawing they
 * continue stands at `pushed` or later — a drawing that was pushed along.
 */
function eatTail(frames: Cell[], pushed: number, n: number): void {
  const key = keyOf(frames, frames.length - 1);
  if (key < pushed) return;
  const spare = frames.length - 1 - key;
  frames.length -= Math.min(n, spare);
}

/** Every layer continued to the longest one: the film is as long as its longest layer. */
function evenOut(doc: ToonDocument): number {
  const total = Math.max(...doc.layers.map((layer) => layer.frames.length));
  for (const layer of doc.layers) {
    while (layer.frames.length < total) layer.frames.push(null);
  }
  return total;
}

/** Whether `extra` cells more still fit in the format. */
export function cellsFit(doc: ToonDocument, extra: number): boolean {
  return length(doc) + extra <= MAX_FRAMES;
}

export function emptyDrawing(): Frame {
  return { strokes: [] };
}

/** What «+» does when the next cell holds a drawing: push that one alone, or the whole tail. */
export type Shift = 'next' | 'all';

/** Whether a new drawing after cell `i` of the layer would land on a drawing — the question of the shift. */
export function nextIsDrawing(doc: ToonDocument, layer: number, i: number): boolean {
  const frames = doc.layers[layer].frames;
  return i + 1 < frames.length && frames[i + 1] !== null;
}

/**
 * «+» on each of `layers` at cell `i`: an empty drawing into the continuation
 * it stands on, or else into the next cell — a continuation is taken over, a
 * drawing is pushed by `shift`, and past the end the film grows. `make` puts
 * a drawing of its own instead (the duplicate: a copy of what the cell shows),
 * always into the next cell. Returns the cell the drawing went into.
 */
export function putAfter(
  doc: ToonDocument,
  layers: readonly number[],
  i: number,
  shift: Shift,
  make?: (frames: readonly Cell[], i: number) => Cell,
): number {
  const here = !make && layers.every((l) => doc.layers[l].frames[i] === null);
  const at = here ? i : i + 1;
  for (const l of layers) {
    const frames = doc.layers[l].frames;
    const drawing = make ? structuredClone(make(frames, i) ?? emptyDrawing()) : emptyDrawing();
    if (at < frames.length && frames[at] === null) {
      frames[at] = drawing;
    } else if (at < frames.length && shift === 'next' && frames[at + 1] === null) {
      // The next drawing steps over one cell of its own pause.
      frames.splice(at + 1, 1);
      frames.splice(at, 0, drawing);
    } else {
      frames.splice(at, 0, drawing);
      eatTail(frames, at + 1, 1);
    }
  }
  evenOut(doc);
  return at;
}

/** Ctrl+«+»: an empty drawing in front of cell `i`, the tail pushed right. */
export function putBefore(doc: ToonDocument, layers: readonly number[], i: number): number {
  insertCells(doc, layers, i, [emptyDrawing()]);
  return i;
}

/**
 * Delete on cell `i` of each of `layers`: a drawing becomes a continuation —
 * the drawing before it lasts on (the first cell, with none before it, is
 * emptied); a continuation leaves its layer, the tail comes a cell left and
 * the layer ends on one continuation more, so the film keeps its length. A
 * continuation with no drawing after it would only come back at the end: its
 * cell ends the drawing instead, on an empty one.
 */
export function deleteCell(doc: ToonDocument, layers: readonly number[], i: number): void {
  for (const l of layers) {
    const frames = doc.layers[l].frames;
    if (frames[i] !== null) {
      frames[i] = i === 0 ? emptyDrawing() : null;
    } else if (frames.slice(i + 1).some((cell) => cell !== null)) {
      frames.splice(i, 1);
      frames.push(null);
    } else {
      frames[i] = emptyDrawing();
    }
  }
}

/** Delete on a block: its cells leave its layers, the tails come left, the film keeps its length. */
export function deleteCells(doc: ToonDocument, layers: readonly number[], from: number, count: number): void {
  const total = length(doc);
  for (const l of layers) {
    const frames = doc.layers[l].frames;
    frames.splice(from, count);
    while (frames.length < total) frames.push(null);
    if (frames[0] === null) frames[0] = emptyDrawing();
  }
}

/** Where the drawing cell `i` shows begins, and how many cells it lasts. */
function spanOf(frames: readonly Cell[], i: number): { key: number; cells: number } {
  const key = keyOf(frames, i);
  let end = key + 1;
  while (end < frames.length && frames[end] === null) end++;
  return { key, cells: end - key };
}

/** How many cells the drawing cell `i` of the layer shows lasts — to its next drawing or the film's end. */
export function durationOf(doc: ToonDocument, layer: number, i: number): number {
  return spanOf(doc.layers[layer].frames, i).cells;
}

/** The drawing cell `i` shows lasts `by` cells longer in each of `layers`; the tails are pushed by the rule of the shift. */
export function lengthen(doc: ToonDocument, layers: readonly number[], i: number, by: number): void {
  for (const l of layers) {
    const frames = doc.layers[l].frames;
    const { key, cells } = spanOf(frames, i);
    const at = key + cells;
    frames.splice(at, 0, ...Array<Cell>(by).fill(null));
    eatTail(frames, at + by, by);
  }
  evenOut(doc);
}

/**
 * The drawing cell `i` shows lasts up to `by` cells shorter, never under one:
 * the tail comes left and the layer ends on continuations. The last drawing
 * of a layer has no tail to pull — it ends earlier on an empty drawing.
 */
export function shorten(doc: ToonDocument, layers: readonly number[], i: number, by: number): void {
  for (const l of layers) {
    const frames = doc.layers[l].frames;
    const { key, cells } = spanOf(frames, i);
    const take = Math.min(by, cells - 1);
    if (take <= 0) continue;
    const end = key + cells;
    if (end < frames.length) {
      frames.splice(end - take, take);
      for (let k = 0; k < take; k++) frames.push(null);
    } else {
      frames[end - take] = emptyDrawing();
    }
  }
}

/** How many drawings with lines stand at cell `from` or later — what a film cut to `from` cells loses. */
export function drawingsPast(doc: ToonDocument, from: number): number {
  return doc.layers.reduce((sum, layer) => sum + layer.frames.slice(from).filter((cell) => !!cell?.strokes.length).length, 0);
}

/** The film made `cells` long: continuations added to every layer's end, or the ends cut off. */
export function setFilmLength(doc: ToonDocument, cells: number): void {
  for (const layer of doc.layers) {
    layer.frames.length = Math.min(layer.frames.length, cells);
    while (layer.frames.length < cells) layer.frames.push(null);
  }
}

/** A copy of the drawing cell `i` shows. */
function shownCopy(frames: readonly Cell[], i: number): Frame {
  return structuredClone(frames[keyOf(frames, i)] ?? emptyDrawing());
}

/**
 * The edge between two drawings of a layer nearest to `to`: a cell put there
 * never splits a pause, so every continuation keeps showing what it showed.
 */
function edgeNear(frames: readonly Cell[], to: number, forward = true): number {
  const at = Math.max(0, Math.min(to, frames.length));
  for (let d = 0; d <= frames.length; d++) {
    for (const b of forward ? [at + d, at - d] : [at - d, at + d]) {
      if (b >= 0 && b <= frames.length && (b === frames.length || frames[b] !== null)) return b;
    }
  }
  return frames.length;
}

/**
 * Carries `count` cells from `from` along each of `layers`, so they land near
 * `to`; the cells between make way and the other layers stand. A drawing goes
 * with its pause — continuations right after the run go too — and a run that
 * opens on a continuation opens on a copy of what that showed. The block lands
 * at one edge, found in the first of `layers`, in every layer; returns it.
 */
export function moveCellsTo(doc: ToonDocument, layers: readonly number[], from: number, count: number, to: number): number {
  // One layer: a drawing goes with its pause. A block of layers carries
  // exactly the cells picked — a pause of a different length in each layer
  // would land the layers apart — and what it leaves of a pause keeps
  // showing its drawing.
  const own = layers.length === 1;
  const runEnd = (frames: readonly Cell[]) => {
    let end = from + count;
    while (own && end < frames.length && frames[end] === null && keyOf(frames, end) >= from) end++;
    return end;
  };
  // Where it would land, found before anything is touched: back on its own
  // place, a carry changes nothing — not even the copies a move leaves.
  if (to === from) return from;
  const first = doc.layers[layers[0]].frames;
  const rest: Cell[] = [...first.slice(0, from), ...first.slice(runEnd(first))];
  // What a block leaves of a pause becomes a drawing, and so an edge.
  if (rest[from] === null && keyOf(first, runEnd(first)) >= from) rest[from] = emptyDrawing();
  if (edgeNear(rest, to, to >= from) === from) return from;
  const rests = layers.map((l) => {
    const frames = doc.layers[l].frames;
    const end = runEnd(frames);
    if (end < frames.length && frames[end] === null && keyOf(frames, end) >= from) frames[end] = shownCopy(frames, end);
    const lifted = frames[from] === null ? shownCopy(frames, from) : frames[from];
    const run = frames.splice(from, end - from);
    run[0] = lifted;
    return { frames, run };
  });
  // One edge for the whole block, found in its first layer; halfway between
  // two, the run goes on the way it was going.
  const at = edgeNear(rests[0].frames, to, to >= from);
  for (const { frames, run } of rests) {
    const place = Math.min(at, frames.length);
    keepShown(frames, place);
    frames.splice(place, 0, ...run);
  }
  return at;
}

/**
 * A continuation at `at` would go on showing whatever is put in front of it:
 * it becomes a copy of what it shows now. Another layer of a block lands at
 * the first layer's edge, which may be the middle of a pause of its own.
 */
function keepShown(frames: Cell[], at: number): void {
  if (at > 0 && at < frames.length && frames[at] === null) frames[at] = shownCopy(frames, at);
}

/**
 * Ctrl+drag of cells: copies of `count` cells from `from` put near `to` in each
 * of `layers`, the originals staying, the tail pushed by the rule of the shift.
 * The copies land at one edge, found in the first of `layers`; returns it.
 */
export function copyCellsTo(doc: ToonDocument, layers: readonly number[], from: number, count: number, to: number): number {
  const at = edgeNear(doc.layers[layers[0]].frames, to);
  for (const l of layers) {
    const frames = doc.layers[l].frames;
    const copies = structuredClone(frames.slice(from, from + count));
    if (copies[0] === null) copies[0] = shownCopy(frames, from);
    keepShown(frames, at);
    frames.splice(at, 0, ...copies);
    eatTail(frames, at + count, count);
  }
  evenOut(doc);
  return at;
}

/**
 * «Сдвинуть влево/вправо» for cells of a layer: the run steps over the whole
 * drawing next to it, pause and all. Returns where it landed in the first of
 * `layers`, or `from` when there is nothing to step over.
 */
export function stepCells(doc: ToonDocument, layers: readonly number[], from: number, count: number, step: -1 | 1): number {
  const frames = doc.layers[layers[0]].frames;
  if (step < 0) {
    if (from === 0) return from;
    return moveCellsTo(doc, layers, from, count, keyOf(frames, from - 1));
  }
  let end = from + count;
  while (end < frames.length && frames[end] === null) end++;
  if (end >= frames.length) return from;
  let next = end + 1;
  while (next < frames.length && frames[next] === null) next++;
  return moveCellsTo(doc, layers, from, count, from + (next - end));
}

/** Whether «Сдвинуть» has a drawing to step over that way. */
export function canStepCells(doc: ToonDocument, layer: number, from: number, count: number, step: -1 | 1): boolean {
  const frames = doc.layers[layer].frames;
  if (step < 0) return from > 0;
  return frames.slice(from + count).some((cell) => cell !== null);
}
