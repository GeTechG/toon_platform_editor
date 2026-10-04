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
}

/**
 * The block edit undo would put back: the newest one that wrote the active
 * cell, while every cell it wrote is still as it left it. Only the top of the
 * history used to be asked — a sweep of the mega eraser on another frame
 * since, and Z here took a piece of a cut line instead of the cut. An older
 * edit of the same cell is never reached past a newer one: a stroke drawn
 * since is undone first, as before.
 */
export function restorableBlock<S extends EditedCell>(
  doc: ToonDocument,
  edits: readonly (readonly S[] | object)[],
  active: Frame | undefined,
): S[] | undefined {
  for (let i = edits.length - 1; i >= 0; i--) {
    const step = edits[i];
    if (!Array.isArray(step) || !step.some((s: S) => s.cell === active)) {
      continue;
    }
    const intact = step.every((s: S) => {
      const cell = doc.layers[s.layer]?.frames[s.frame];
      return cell === s.cell && cell.strokes.length === s.after;
    });
    return intact ? step : undefined;
  }
  return undefined;
}

export function restoreStructure(doc: ToonDocument, snap: StructureSnapshot): void {
  doc.layers = [...snap.layers];
  snap.layers.forEach((layer, l) => {
    layer.frames = [...snap.frames[l]];
    const first = layer.frames[0];
    if (first && first.strokes.length === 0 && snap.firstStrokes[l].length > 0) {
      first.strokes.push(...snap.firstStrokes[l]);
    }
  });
}
