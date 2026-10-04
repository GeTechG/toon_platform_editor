import type { Frame, Layer, Stroke, ToonDocument } from '../format/types';

/**
 * The document's shape before a frame or layer delete, and after it. Cells
 * are kept by reference — a delete only splices arrays (and, when it takes
 * every frame, clears the first cell, whose strokes are copied here). Undo
 * is offered while the document is still exactly what the delete left:
 * same layers, same cells, same stroke counts, the rule block edits follow.
 */
export interface StructureSnapshot {
  kind: 'structure';
  layers: Layer[];
  frames: Frame[][];
  firstStrokes: Stroke[][];
  after: { layers: Layer[]; frames: Frame[][]; counts: number[][] } | null;
  /** Records the shape the delete left; call it right after the write. */
  seal(doc: ToonDocument): void;
}

export function takeStructure(doc: ToonDocument): StructureSnapshot {
  return {
    kind: 'structure',
    layers: [...doc.layers],
    frames: doc.layers.map((l) => [...l.frames]),
    firstStrokes: doc.layers.map((l) => [...(l.frames[0]?.strokes ?? [])]),
    after: null,
    seal(d) {
      // Only a delete that took every frame empties the first cells. Kept for
      // the others too, a first frame emptied since by another undo — a paste
      // taken back — was filled again with the frames put back.
      this.firstStrokes = this.firstStrokes.map((strokes, l) => (this.frames[l][0]?.strokes.length ? [] : strokes));
      this.after = {
        layers: [...d.layers],
        frames: d.layers.map((l) => [...l.frames]),
        counts: d.layers.map((l) => l.frames.map((f) => f.strokes.length)),
      };
    },
  };
}

// ponytail: walks every cell on each check (20 layers × 4096 frames at most);
// keep a version counter on the document if canUndo ever shows in a profile.
export function structureIntact(doc: ToonDocument, snap: StructureSnapshot): boolean {
  const after = snap.after;
  if (!after || doc.layers.length !== after.layers.length) {
    return false;
  }
  return doc.layers.every((layer, l) =>
    layer === after.layers[l]
    && layer.frames.length === after.frames[l].length
    && layer.frames.every((cell, f) => cell === after.frames[l][f] && cell.strokes.length === after.counts[l][f]),
  );
}

/** One cell of a block edit, as undo recognises it: the cell it left and its count. */
export interface EditedCell {
  cell: Frame;
  layer: number;
  frame: number;
  after: number;
  /**
   * The stroke the edit left on top. The count alone does not tell: one stroke
   * taken off a pasted cell and another drawn in its place, and Z took the
   * paste back with the new stroke in it.
   */
  last?: Stroke;
}

/** The same mark: redo puts a copy back, so the object is not asked. */
function sameStroke(a: Stroke | undefined, b: Stroke | undefined): boolean {
  if (a === b || !a || !b) {
    return a === b;
  }
  const same = (x: readonly number[] | undefined, y: readonly number[] | undefined) =>
    (x?.length ?? 0) === (y?.length ?? 0) && (x ?? []).every((v, i) => v === y![i]);
  return a.tool_id === b.tool_id && same(a.points, b.points) && same(a.pressure, b.pressure);
}

/**
 * The block edit undo would put back: the newest one that wrote the active
 * cell, while every cell it wrote is still as it left it. Only the top of the
 * history used to be asked — a sweep of the mega eraser on another frame
 * since, and Z here took a piece of a cut line instead of the cut. An older
 * edit of the same cell is never reached past a newer one: a stroke drawn
 * since is undone first, as before.
 *
 * A step over several cells goes back whole while it is whole. Once another
 * of its cells was edited since, the cell stood on goes back alone (owner,
 * after the twenty-first audit) and the rest stays in the history, to be
 * taken back from its own frame: Z used to take a stroke of the pasted
 * drawing instead, and the paste had no way back at all. What comes back is
 * the step itself, or the one cell of it — `dropCells` takes either off.
 */
export function restorableBlock<S extends EditedCell>(
  doc: ToonDocument,
  edits: readonly (readonly S[] | object)[],
  active: Frame | undefined,
): S[] | undefined {
  // Cells the steps passed over left: a transform or a mirror rewrites a cell
  // in place — same object, same count — so a paste over two frames looked
  // untouched under a transform made since on the other one, and went back
  // past it.
  const newer = new Set<Frame>();
  for (let i = edits.length - 1; i >= 0; i--) {
    const step = edits[i];
    if (!Array.isArray(step)) {
      continue;
    }
    if (!step.some((s: S) => s.cell === active)) {
      step.forEach((s: S) => newer.add(s.cell));
      continue;
    }
    const intact = (s: S) =>
      placeOf(doc, s) !== undefined && s.cell.strokes.length === s.after && !newer.has(s.cell)
      && (s.last === undefined || sameStroke(s.cell.strokes[s.after - 1], s.last));
    if (step.every(intact)) {
      return step;
    }
    const own = step.filter((s: S) => s.cell === active && intact(s));
    return own.length > 0 ? own : undefined;
  }
  return undefined;
}

/**
 * The history without the cells undo has just put back: the whole step, or
 * the one cell of it. A step left with no cells is gone — kept, it would be a
 * step that undoes nothing.
 */
export function dropCells<T>(edits: readonly T[], back: readonly EditedCell[]): T[] {
  const gone = new Set<unknown>(back);
  return edits
    .map((step) => (Array.isArray(step) && step !== back ? step.filter((s) => !gone.has(s)) as T : step))
    .filter((step) => step !== back && !(Array.isArray(step) && step.length === 0));
}

/**
 * Where a cell of a block edit stands now. The numbers it was filed under go
 * stale: a frame or a layer added in front moves the cell along, and looked up
 * by them the cut was never found again — Z took a piece of a cut line.
 */
function placeOf(doc: ToonDocument, s: EditedCell): { layer: number; frame: number } | undefined {
  if (doc.layers[s.layer]?.frames[s.frame] === s.cell) {
    return s;
  }
  // ponytail: a scan of the document, only for a cell that has moved — its
  // own row first, where a frame added in front leaves it.
  const rows = doc.layers.map((_, layer) => layer);
  for (const layer of doc.layers[s.layer] ? [s.layer, ...rows] : rows) {
    const frame = doc.layers[layer].frames.indexOf(s.cell);
    if (frame !== -1) {
      return { layer, frame };
    }
  }
  return undefined;
}

/** Re-points a block edit at the places its cells stand in now, before undo writes them. */
export function placeBlock(doc: ToonDocument, step: readonly EditedCell[]): void {
  for (const s of step) {
    const at = placeOf(doc, s);
    if (at) {
      s.layer = at.layer;
      s.frame = at.frame;
    }
  }
}

/**
 * A block edit undone puts a new cell object where `from` stood. The deletes
 * in the history know their cells by the object: left pointing at the old
 * one, a frame deleted before a sweep of the eraser never came back once the
 * sweep was undone. `grew` is how many strokes the undo gave the cell back.
 */
export function recell(snap: StructureSnapshot, from: Frame, to: Frame, grew = 0): void {
  const swap = (rows: Frame[][], counts?: number[][]) => rows.forEach((row, l) => row.forEach((cell, f) => {
    if (cell === from) {
      row[f] = to;
      if (counts) counts[l][f] += grew;
    }
  }));
  swap(snap.frames);
  if (snap.after) swap(snap.after.frames, snap.after.counts);
}

/** A step of the history as undo walks it: a block edit's cells, or a delete or a move. */
type HistoryStep =
  | readonly (EditedCell & { was: Frame })[]
  | { snap: StructureSnapshot; redo?: { snap: StructureSnapshot } };

/**
 * A block edit undone puts `restored` where its cell stood: every step left in
 * the history that knew the cell by the old object is re-pointed. `undone` is
 * the cell of the step taken back — what it left, and what it was made over.
 */
export function repoint(steps: readonly HistoryStep[], undone: EditedCell & { was: Frame }, restored: Frame): void {
  const grew = restored.strokes.length - undone.after;
  for (const step of steps) {
    if ('snap' in step) {
      // A delete or a layer move: unmatched, a frame deleted before a sweep
      // never came back once the sweep was undone.
      for (const snap of step.redo ? [step.snap, step.redo.snap] : [step.snap]) {
        recell(snap, undone.cell, restored, grew);
        recell(snap, undone.was, restored);
      }
      continue;
    }
    for (const older of step) {
      // The step under this one knows the cell by the object it left:
      // unmatched, a second Z after two sweeps took a stroke instead of
      // giving the first sweep back.
      if (older.cell === undone.was) {
        older.cell = restored;
      }
      // A transform or a mirror writes in place — the cell it was made over
      // is the cell it left. Left pointing at the old object, the third Z
      // after three mirrors found no step and took a stroke.
      if (older.was === undone.was) {
        older.was = restored;
      }
    }
  }
}

export function restoreStructure(doc: ToonDocument, snap: StructureSnapshot): void {
  doc.layers = [...snap.layers];
  snap.layers.forEach((layer, l) => {
    layer.frames = [...snap.frames[l]];
    const first = layer.frames[0];
    // Sealed by a delete only: the shape a move is redone to empties nothing.
    if (snap.after && first && first.strokes.length === 0 && snap.firstStrokes[l].length > 0) {
      first.strokes.push(...snap.firstStrokes[l]);
    }
  });
}
