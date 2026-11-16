import { describe, expect, it } from 'bun:test';
import type { Cell, ToonDocument } from '../format/types';
import { validateDocument } from '../format/validate';
import { restoreStructure, structureIntact, takeStructure } from '../ui/structure-undo';
import { stepCells, copyCellsTo, moveCellsTo, drawingsPast, durationOf, lengthen, setFilmLength, shorten, deleteCell, deleteCells, insertCells, nextIsDrawing, putAfter, putBefore } from './exposure';

/**
 * A layer as the specs write it: a letter is a drawing (its strokes say which
 * letter), `○` an empty drawing, `·` a continuation.
 */
function layerOf(text: string): Cell[] {
  return text.split(' ').filter(Boolean).map((mark) => {
    if (mark === '·') return null;
    if (mark === '○') return { strokes: [] };
    return { strokes: [{ points: [mark.charCodeAt(0), 0], tool_id: 0 }] };
  });
}

function docOf(...layers: string[]): ToonDocument {
  return {
    schema_version: 8,
    width: 100,
    height: 100,
    frame_rate: 12,
    tools: [{ kind: 'pencil', geometry: 'smooth', width: 4, color: '#000000' }],
    layers: layers.map((text) => ({ hidden: false, frames: layerOf(text) })),
  };
}

/** A layer back as text; a copy of a drawing reads as the drawing. */
function text(doc: ToonDocument, layer = 0): string {
  return doc.layers[layer].frames.map((cell) => {
    if (cell === null) return '·';
    const stroke = cell.strokes[0];
    return stroke ? String.fromCharCode(stroke.points[0]) : '○';
  }).join(' ');
}

describe('insertCells — the shift of a layer', () => {
  it('eats a continuation at the end of the layer', () => {
    const doc = docOf('A B · ·', 'F · · ·');
    insertCells(doc, [0], 1, [{ strokes: [] }]);
    expect(text(doc)).toBe('A ○ B ·');
    expect(text(doc, 1)).toBe('F · · ·');
  });

  it('lengthens the film when the layer has nothing to eat, and the rest continue', () => {
    const doc = docOf('A B C', 'F');
    insertCells(doc, [0], 1, [{ strokes: [] }]);
    expect(text(doc)).toBe('A ○ B C');
    expect(text(doc, 1)).toBe('F · · ·');
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('lengthens a drawing at the end of the layer instead of eating its own pause', () => {
    const doc = docOf('A B · ·', 'F · · ·');
    insertCells(doc, [0], 2, [null]);
    expect(text(doc)).toBe('A B · · ·');
    expect(text(doc, 1)).toBe('F · · · ·');
  });
});

describe('«+» on a layer', () => {
  it('puts an empty drawing into a continuation it stands on', () => {
    const doc = docOf('A · · ·');
    expect(putAfter(doc, [0], 2, 'all')).toBe(2);
    expect(text(doc)).toBe('A · ○ ·');
  });

  it('puts it into the next cell when that is a continuation', () => {
    const doc = docOf('A · B');
    expect(nextIsDrawing(doc, 0, 0)).toBe(false);
    expect(putAfter(doc, [0], 0, 'all')).toBe(1);
    expect(text(doc)).toBe('A ○ B');
  });

  it('adds a cell at the end of the film, the other layers continue', () => {
    const doc = docOf('F', 'P');
    expect(putAfter(doc, [1], 0, 'all')).toBe(1);
    expect(text(doc, 1)).toBe('P ○');
    expect(text(doc, 0)).toBe('F ·');
  });

  it('asks when the next cell is a drawing: only the next one moves', () => {
    const doc = docOf('A B · · C');
    expect(nextIsDrawing(doc, 0, 0)).toBe(true);
    expect(putAfter(doc, [0], 0, 'next')).toBe(1);
    expect(text(doc)).toBe('A ○ B · C');
  });

  it('moves the whole tail when the next drawing has no pause to eat', () => {
    const doc = docOf('A B C', 'F');
    expect(putAfter(doc, [0], 0, 'next')).toBe(1);
    expect(text(doc)).toBe('A ○ B C');
    expect(text(doc, 1)).toBe('F · · ·');
  });

  it('moves everything further on', () => {
    const doc = docOf('A B C', 'F');
    putAfter(doc, [0], 0, 'all');
    expect(text(doc)).toBe('A ○ B C');
  });

  it('puts a given drawing — the duplicate — by the same rules', () => {
    const doc = docOf('A · B');
    putAfter(doc, [0], 0, 'all', (frames, i) => frames[i]);
    expect(text(doc)).toBe('A A B');
    expect(doc.layers[0].frames[1]).not.toBe(doc.layers[0].frames[0]);
  });

  it('Ctrl+«+» puts an empty drawing in front of the current one', () => {
    const doc = docOf('A B C');
    expect(putBefore(doc, [0], 1)).toBe(1);
    expect(text(doc)).toBe('A ○ B C');
  });
});

describe('Delete on a layer', () => {
  it('turns a drawing into a continuation of the one before', () => {
    const doc = docOf('A B C');
    deleteCell(doc, [0], 1);
    expect(text(doc)).toBe('A · C');
  });

  it('empties the first cell, which has nothing before it to continue', () => {
    const doc = docOf('A B');
    deleteCell(doc, [0], 0);
    expect(text(doc)).toBe('○ B');
  });

  it('takes a continuation out: the tail comes left, the layer ends on a continuation', () => {
    const doc = docOf('A · · · B', 'F · · · ·');
    deleteCell(doc, [0], 2);
    expect(text(doc)).toBe('A · · B ·');
    expect(text(doc, 1)).toBe('F · · · ·');
  });

  it('ends the layer on an empty drawing from a continuation with no drawing after it', () => {
    const doc = docOf('A · · ·');
    deleteCell(doc, [0], 2);
    expect(text(doc)).toBe('A · ○ ·');
  });

  it('takes a block out of its layers and keeps the film as long', () => {
    const doc = docOf('A B C D', 'F · · ·');
    deleteCells(doc, [0], 1, 2);
    expect(text(doc)).toBe('A D · ·');
    expect(text(doc, 1)).toBe('F · · ·');
  });

  it('opens a layer whose block from the first cell went on an empty drawing', () => {
    const doc = docOf('A · B');
    deleteCells(doc, [0], 0, 1);
    expect(text(doc)).toBe('○ B ·');
  });
});

describe('a drawing\'s duration', () => {
  it('counts the cells to the next drawing, or to the end of the film', () => {
    const doc = docOf('A · · B ·');
    expect(durationOf(doc, 0, 1)).toBe(3);
    expect(durationOf(doc, 0, 3)).toBe(2);
  });

  it('a pause for the character: the tail pushed, the film longer, the background continues', () => {
    const doc = docOf('F', 'A B C');
    doc.layers[0].frames.push(null, null);
    lengthen(doc, [1], 1, 2);
    expect(text(doc, 1)).toBe('A B · · C');
    expect(text(doc, 0)).toBe('F · · · ·');
  });

  it('shortening pulls the tail and keeps the film as long', () => {
    const doc = docOf('A · · B');
    shorten(doc, [0], 0, 1);
    expect(text(doc)).toBe('A · B ·');
  });

  it('never below one cell', () => {
    const doc = docOf('A B');
    shorten(doc, [0], 0, 5);
    expect(text(doc)).toBe('A B');
  });

  it('the last drawing ends earlier on an empty one', () => {
    const doc = docOf('A · ·', 'F · ·');
    shorten(doc, [0], 0, 1);
    expect(text(doc)).toBe('A · ○');
    expect(durationOf(doc, 0, 0)).toBe(2);
  });
});

describe('the film\'s length', () => {
  it('a longer film: every layer\'s last drawing lasts to the end', () => {
    const doc = docOf('A B · ·', 'F · · ·');
    setFilmLength(doc, 6);
    expect(text(doc)).toBe('A B · · · ·');
    expect(text(doc, 1)).toBe('F · · · · ·');
  });

  it('counts the drawings a shorter film would lose', () => {
    const doc = docOf('A B · C D', 'F · · · ·');
    expect(drawingsPast(doc, 2)).toBe(2);
    expect(drawingsPast(doc, 4)).toBe(1);
    expect(drawingsPast(doc, 5)).toBe(0);
    // An empty drawing loses nothing.
    expect(drawingsPast(docOf('A ○ ○'), 1)).toBe(0);
    setFilmLength(doc, 2);
    expect(text(doc)).toBe('A B');
    expect(text(doc, 1)).toBe('F ·');
  });
});

describe('cells carried in their own layer', () => {
  it('a cell goes along its layer, the others stand', () => {
    const doc = docOf('F · · ·', 'A B C D');
    expect(moveCellsTo(doc, [1], 1, 1, 3)).toBe(3);
    expect(text(doc, 1)).toBe('A C D B');
    expect(text(doc, 0)).toBe('F · · ·');
  });

  it('a drawing goes with its pause', () => {
    const doc = docOf('A · · B');
    expect(moveCellsTo(doc, [0], 0, 1, 3)).toBe(1);
    expect(text(doc)).toBe('B A · ·');
  });

  it('never lands inside a pause: it stops at the nearest drawing\'s edge', () => {
    const doc = docOf('A B · · · C');
    expect(moveCellsTo(doc, [0], 0, 1, 2)).toBe(4);
    expect(text(doc)).toBe('B · · · A C');
  });

  it('a continuation carried away takes a copy of what it showed', () => {
    const doc = docOf('A · · B');
    moveCellsTo(doc, [0], 1, 1, 3);
    expect(text(doc)).toBe('A · B A');
  });

  it('a copy of a continuation is a copy of what it showed', () => {
    const doc = docOf('A · B');
    expect(copyCellsTo(doc, [0], 1, 1, 3)).toBe(3);
    expect(text(doc)).toBe('A · B A');
  });

  it('a copy into the middle pushes the tail by the rule of the shift', () => {
    const doc = docOf('A B · ·', 'F · · ·');
    copyCellsTo(doc, [0], 0, 1, 1);
    expect(text(doc)).toBe('A A B ·');
    expect(text(doc, 1)).toBe('F · · ·');
  });
});

describe('each operation is one step of undo', () => {
  const steps: [string, string[], (doc: ToonDocument) => void][] = [
    ['«+» past the end', ['A B', 'F ·'], (doc) => putAfter(doc, [0], 1, 'all')],
    ['the shift window', ['A B · C', 'F · · ·'], (doc) => putAfter(doc, [0], 0, 'next')],
    ['Ctrl+«+»', ['A B'], (doc) => putBefore(doc, [0], 0)],
    ['Delete on the first drawing', ['A B'], (doc) => deleteCell(doc, [0], 0)],
    ['Delete on a continuation', ['A · B'], (doc) => deleteCell(doc, [0], 1)],
    ['a block deleted', ['A B C'], (doc) => deleteCells(doc, [0], 0, 2)],
    ['a longer drawing', ['A B', 'F ·'], (doc) => lengthen(doc, [0], 0, 3)],
    ['a shorter drawing', ['A · ·'], (doc) => shorten(doc, [0], 0, 1)],
    ['a shorter film', ['A B C', 'F · G'], (doc) => setFilmLength(doc, 1)],
    ['cells carried', ['A · B'], (doc) => moveCellsTo(doc, [0], 0, 1, 3)],
    ['cells copied', ['A · B', 'F · ·'], (doc) => copyCellsTo(doc, [0], 1, 1, 3)],
  ];
  for (const [name, layers, step] of steps) {
    it(name, () => {
      const doc = docOf(...layers);
      const before = doc.layers.map((_, l) => text(doc, l));
      const snap = takeStructure(doc);
      step(doc);
      snap.seal(doc);
      expect(validateDocument(doc).ok).toBe(true);
      expect(structureIntact(doc, snap)).toBe(true);
      restoreStructure(doc, snap);
      expect(doc.layers.map((_, l) => text(doc, l))).toEqual(before);
    });
  }
});

describe('«Сдвинуть» on cells of a layer', () => {
  it('right steps over the next drawing with its pause', () => {
    const doc = docOf('A B · · C');
    expect(stepCells(doc, [0], 0, 1, 1)).toBe(3);
    expect(text(doc)).toBe('B · · A C');
  });

  it('left steps over the drawing before', () => {
    const doc = docOf('A · B C');
    expect(stepCells(doc, [0], 2, 1, -1)).toBe(0);
    expect(text(doc)).toBe('B A · C');
  });

  it('a block from the menu', () => {
    const doc = docOf('A B C D');
    expect(stepCells(doc, [0], 1, 2, -1)).toBe(0);
    expect(text(doc)).toBe('B C A D');
  });
});

describe('a block of layers stays one block', () => {
  it('lands at one edge in every layer, the others keep what they showed', () => {
    const doc = docOf('A B · · C D', 'E F G H I J');
    expect(moveCellsTo(doc, [0, 1], 0, 1, 2)).toBe(3);
    expect(text(doc, 0)).toBe('B · · A C D');
    expect(text(doc, 1)).toBe('F G H E I J');
  });

  it('carries exactly the cells picked: a pause it leaves behind keeps showing its drawing', () => {
    const doc = docOf('A B C D', 'E · · ·');
    expect(moveCellsTo(doc, [0, 1], 0, 1, 2)).toBe(2);
    expect(text(doc, 0)).toBe('B C A D');
    expect(text(doc, 1)).toBe('E · E E');
  });

  it('a layer whose pause the edge falls in keeps showing it: the rest of the pause is a copy', () => {
    const doc = docOf('A B C D', 'E · · ·');
    moveCellsTo(doc, [0, 1], 3, 1, 1);
    expect(text(doc, 0)).toBe('A D B C');
    expect(text(doc, 1)).toBe('E E E ·');
  });

  it('copies land at one edge too', () => {
    const doc = docOf('A B · ·', 'E F G H');
    expect(copyCellsTo(doc, [0, 1], 0, 1, 3)).toBe(4);
    expect(text(doc, 0)).toBe('A B · · A');
    expect(text(doc, 1)).toBe('E F G H E');
  });
});

describe('a carry back to where it began', () => {
  it('changes nothing, in a block of layers too', () => {
    const doc = docOf('A B C D', 'E · · ·');
    expect(moveCellsTo(doc, [0, 1], 0, 1, 0)).toBe(0);
    expect(doc.layers[1].frames).toEqual(docOf('A', 'E · · ·').layers[1].frames);
    // Snapped back onto its own place from a pointer a little off it.
    const one = docOf('A B · · · C');
    const before = one.layers[0].frames.slice();
    expect(moveCellsTo(one, [0], 0, 1, 1)).toBe(0);
    expect(one.layers[0].frames).toEqual(before);
    expect(one.layers[0].frames.every((cell, i) => cell === before[i])).toBe(true);
  });

  it('a continuation or a cell before a pause, carried to its own place, stays as it was', () => {
    const doc = docOf('A · · B', 'E F G H');
    moveCellsTo(doc, [0, 1], 0, 1, 0);
    expect(text(doc, 0)).toBe('A · · B');
    const one = docOf('A · · B');
    expect(moveCellsTo(one, [0], 1, 1, 1)).toBe(1);
    expect(text(one)).toBe('A · · B');
  });
});
