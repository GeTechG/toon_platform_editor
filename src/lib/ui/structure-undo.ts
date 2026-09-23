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
