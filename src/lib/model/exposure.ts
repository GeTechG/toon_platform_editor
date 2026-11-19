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

/**
 * «+» on picked columns (new-key-on-all-layers): an empty drawing into each
 * continuation of `count` columns from `from` in each of `layers`; drawings
 * stay and nothing shifts. Returns whether a cell changed.
 */
export function keyColumns(doc: ToonDocument, layers: readonly number[], from: number, count: number): boolean {
  let changed = false;
  for (const l of layers) {
    const frames = doc.layers[l].frames;
    for (let i = from; i < from + count; i++) {
      if (frames[i] !== null) continue;
      frames[i] = emptyDrawing();
      changed = true;
    }
  }
  return changed;
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

/** A drawing lasts until its layer's next key or the end of the film. */
export function exposureRange(frames: readonly Cell[], i: number) {
  const start = keyOf(frames, i);
  let end = i + 1;
  while (end < frames.length && frames[end] === null) end++;
  const duration = end - start;
  // Only a later drawing's trailing continuations can absorb a shift.
  const spare = end === frames.length ? 0 : frames.length - 1 - keyOf(frames, frames.length - 1);
  return { start, duration, spare, maxDuration: duration + spare + MAX_FRAMES - frames.length };
}

export function resizeExposure(doc: ToonDocument, layer: number, i: number, duration: number): void {
  const frames = doc.layers[layer].frames;
  const range = exposureRange(frames, i);
  const by = Math.min(range.maxDuration, Math.max(1, Math.round(duration))) - range.duration;
  if (!Number.isFinite(by) || by === 0) return;
  const end = range.start + range.duration;
  if (by > 0) {
    // A film can hold 100,000 ticks. Concatenate the pause without spreading
    // a potentially film-sized array into splice arguments.
    const extended = frames.slice(0, end).concat(Array<Cell>(by).fill(null), frames.slice(end));
    eatTail(extended, end + by, by);
    doc.layers[layer].frames = extended;
    evenOut(doc);
  } else if (end < frames.length) {
    frames.copyWithin(end + by, end);
    frames.fill(null, frames.length + by);
  } else {
    frames[end + by] = emptyDrawing();
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
 * Carries (or, with `copy`, copies) `count` cells from `from` in each of
 * `layers` to tick `to` (owner, 2026-11-17: a frame goes where it is let go).
 * A carry swaps places with what stands there: the cells under the pointer go
 * to the place left, and as the drag goes on (each step laid again from its
 * start) the one swapped with goes back where it stood. A pause does not
 * travel with its drawing. A run that overlaps its own place is rotated
 * instead. A layer with no drawing among the cells is left as it is; a layer
 * left opening on a continuation opens on an empty drawing. A copy lands on
 * continuations where there are only continuations, and pushes the rest of
 * the layer by the rule of the shift where a drawing stands. Returns where the
 * cells landed.
 */
export function placeCells(
  doc: ToonDocument,
  layers: readonly number[],
  from: number,
  count: number,
  to: number,
  copy = false,
): number {
  const total = length(doc);
  const at = Math.max(0, Math.min(to, copy ? total : total - count));
  if (!copy && at === from) return from;
  for (const l of layers) {
    const frames = doc.layers[l].frames;
    if (!copy) {
      if (frames.slice(from, from + count).every((cell) => cell === null)) continue;
      if (Math.abs(at - from) >= count) {
        const run = frames.slice(from, from + count);
        const there = frames.slice(at, at + count);
        run.forEach((cell, k) => (frames[at + k] = cell));
        there.forEach((cell, k) => (frames[from + k] = cell));
      } else {
        frames.splice(at, 0, ...frames.splice(from, count));
      }
      if (frames[0] === null) frames[0] = emptyDrawing();
      continue;
    }
    const run: Cell[] = structuredClone(frames.slice(from, from + count));
    if (run[0] === null) run[0] = shownCopy(frames, from);
    const free = at + count <= frames.length && frames.slice(at, at + count).every((cell) => cell === null);
    if (free) {
      run.forEach((cell, k) => (frames[at + k] = cell));
    } else {
      frames.splice(at, 0, ...run);
      eatTail(frames, at + count, count);
    }
  }
  evenOut(doc);
  return at;
}

/** Whole clips touched by a cell selection, measured before a drag starts. */
export function exposurePack(doc: ToonDocument, layers: readonly number[], from: number, count: number) {
  const total = length(doc);
  const rows = layers.map((layer) => {
    const frames = doc.layers[layer].frames;
    const start = keyOf(frames, from);
    let end = from + count;
    while (end < total && frames[end] === null) end++;
    return { layer, start, end };
  });
  // A rectangular selection can follow the part shared by all selected rows.
  const start = Math.max(...rows.map(row => row.start));
  const end = Math.min(...rows.map(row => row.end));
  const first = -Math.min(...rows.map(row => row.start));
  const last = total - Math.max(...rows.map(row => row.end));
  const offsets: number[] = [];
  for (let by = first; by <= last; by++) {
    // The far edge must clear a whole neighbor in every participating row.
    if (by === 0 || rows.every(row => {
      const edge = (by < 0 ? row.start : row.end) + by;
      return edge === total || doc.layers[row.layer].frames[edge] !== null;
    })) offsets.push(by);
  }
  return { rows, from: start, count: end - start, offsets };
}

export type ExposurePack = ReturnType<typeof exposurePack>;

/** The nearest landing to the pointer, measured in ticks from the original pack. */
export function packOffset({ offsets }: ExposurePack, by: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsets[mid] < by) lo = mid + 1;
    else hi = mid;
  }
  const right = offsets[lo];
  const left = offsets[Math.max(0, lo - 1)];
  const diff = Math.abs(by - left) - Math.abs(right - by);
  return diff < 0 || (diff === 0 && by < 0) ? left : right;
}

/** Insert the pack at its snapped landing, shifting the intervening clips in order. */
export function moveExposurePack(doc: ToonDocument, pack: ExposurePack, by: number): void {
  if (by === 0) return;
  for (const { layer, start, end } of pack.rows) {
    const frames = doc.layers[layer].frames;
    const carried = frames.slice(start, end);
    const landing = start + by;
    if (by < 0) {
      frames.copyWithin(end + by, landing, start);
    } else {
      frames.copyWithin(start, end, end + by);
    }
    carried.forEach((cell, i) => { frames[landing + i] = cell; });
  }
}
