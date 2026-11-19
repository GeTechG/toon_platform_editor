import { describe, expect, it } from 'bun:test';
import { MAX_FRAMES } from '../format/constants';
import type { Cell, ToonDocument } from '../format/types';
import { validateDocument } from '../format/validate';
import { restoreStructure, structureIntact, takeStructure } from '../ui/structure-undo';
import { exposurePack, moveExposurePack, packOffset, resizeExposure, keyColumns, placeCells, drawingsPast, setFilmLength, deleteCell, deleteCells, insertCells, nextIsDrawing, putAfter, putBefore } from './exposure';

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

describe('moving complete timeline clips', () => {
  it('inserts the two-tick clip at tick 9 before tick 6, keeping ticks 6–8 in order', () => {
    const doc = docOf('P · · · · A ○ B C · D');
    const pack = exposurePack(doc, [0], 8, 1);
    moveExposurePack(doc, pack, packOffset(pack, -3));
    expect(text(doc)).toBe('P · · · · C · A ○ B D');
  });

  it('takes both partially selected clips, including their full holds, to the end', () => {
    const doc = docOf('A · · B · C · D', 'F · · · · · · ·');
    const pack = exposurePack(doc, [0], 2, 2);
    expect([pack.from, pack.count]).toEqual([0, 5]);
    const offset = packOffset(pack, 20);
    moveExposurePack(doc, pack, offset);
    expect(text(doc)).toBe('C · D A · · B ·');
    expect(text(doc, 1)).toBe('F · · · · · · ·');
  });

  it('snaps to whole neighbors when carrying left from a continuation', () => {
    const doc = docOf('A · B C · ·');
    const pack = exposurePack(doc, [0], 5, 1);
    expect(pack.offsets).toEqual([-3, -1, 0]);
    moveExposurePack(doc, pack, packOffset(pack, -3));
    expect(text(doc)).toBe('C · · A · B');
  });

  it('moves differently sized exposures on selected layers by the same number of ticks', () => {
    const doc = docOf('A B · C · D', 'E · F G · H', 'I · · · · ·');
    const pack = exposurePack(doc, [0, 1], 2, 1);
    expect(pack.offsets).toEqual([0, 2, 3]);
    moveExposurePack(doc, pack, packOffset(pack, 2));
    expect(text(doc)).toBe('A C · B · D');
    expect(text(doc, 1)).toBe('E · G · F H');
    expect(text(doc, 2)).toBe('I · · · · ·');
  });
});

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

describe('«+» on a picked column', () => {
  it('puts an empty drawing into each continuation of the column and leaves the drawings', () => {
    const doc = docOf('F · · · ·', 'A B C D E');
    expect(keyColumns(doc, [0, 1], 2, 1)).toBe(true);
    expect(text(doc)).toBe('F · ○ · ·');
    expect(text(doc, 1)).toBe('A B C D E');
  });

  it('changes nothing where every layer holds a drawing', () => {
    const doc = docOf('F G', 'A B');
    expect(keyColumns(doc, [0, 1], 1, 1)).toBe(false);
    expect(text(doc)).toBe('F G');
    expect(text(doc, 1)).toBe('A B');
  });

  it('keys every column of a run', () => {
    const doc = docOf('F · · · · · ·', 'A · · · B · ·');
    keyColumns(doc, [0, 1], 3, 3);
    expect(text(doc)).toBe('F · · ○ ○ ○ ·');
    expect(text(doc, 1)).toBe('A · · ○ B ○ ·');
  });

  it('leaves the layers it is not given — the locked ones', () => {
    const doc = docOf('F · ·', 'A · ·');
    keyColumns(doc, [1], 1, 1);
    expect(text(doc)).toBe('F · ·');
    expect(text(doc, 1)).toBe('A ○ ·');
  });
});

describe('resizing a drawing on its layer', () => {
  it('shortens to one tick and brings later drawings on that layer forward', () => {
    const doc = docOf('A · · B · C', 'F · G · H ·');
    resizeExposure(doc, 0, 2, 0);
    expect(text(doc)).toBe('A B · C · ·');
    expect(text(doc, 1)).toBe('F · G · H ·');
  });

  it('ends the last drawing with a blank while the other layer keeps playing', () => {
    const doc = docOf('A B · ·', 'F · G H');
    resizeExposure(doc, 0, 3, 2);
    expect(text(doc)).toBe('A B · ○');
    expect(text(doc, 1)).toBe('F · G H');
  });

  it('can still extend at the film limit when a later drawing has time to spare', () => {
    const doc = docOf('A B');
    setFilmLength(doc, MAX_FRAMES);
    resizeExposure(doc, 0, 0, MAX_FRAMES);
    expect(doc.layers[0].frames).toHaveLength(MAX_FRAMES);
    expect(doc.layers[0].frames.at(-1)?.strokes[0].points[0]).toBe('B'.charCodeAt(0));
  });

  it('extends a held drawing, consuming spare time at the end before growing the film', () => {
    const doc = docOf('A · B C ·', 'F G · H ·');
    resizeExposure(doc, 0, 1, 4);
    expect(text(doc)).toBe('A · · · B C');
    expect(text(doc, 1)).toBe('F G · H · ·');
    expect(validateDocument(doc).ok).toBe(true);
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

describe('each operation is one step of undo', () => {
  const steps: [string, string[], (doc: ToonDocument) => void][] = [
    ['«+» past the end', ['A B', 'F ·'], (doc) => putAfter(doc, [0], 1, 'all')],
    ['the shift window', ['A B · C', 'F · · ·'], (doc) => putAfter(doc, [0], 0, 'next')],
    ['Ctrl+«+»', ['A B'], (doc) => putBefore(doc, [0], 0)],
    ['Delete on the first drawing', ['A B'], (doc) => deleteCell(doc, [0], 0)],
    ['Delete on a continuation', ['A · B'], (doc) => deleteCell(doc, [0], 1)],
    ['a block deleted', ['A B C'], (doc) => deleteCells(doc, [0], 0, 2)],
    ['a stretched drawing', ['A B', 'F G'], (doc) => resizeExposure(doc, 0, 0, 4)],
    ['a shorter film', ['A B C', 'F · G'], (doc) => setFilmLength(doc, 1)],
    ['cells carried', ['A · B'], (doc) => placeCells(doc, [0], 0, 1, 2)],
    ['cells copied', ['A · B', 'F · ·'], (doc) => placeCells(doc, [0], 1, 1, 3, true)],
    ['a column keyed', ['A · ·', 'F · G'], (doc) => keyColumns(doc, [0, 1], 1, 2)],
    ['a column carried', ['A B · ·', 'F · G ·'], (doc) => placeCells(doc, [0, 1], 1, 1, 0)],
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


describe('a frame goes where it is let go', () => {
  it('one tick on: the place left goes on showing the drawing before it', () => {
    const doc = docOf('D ○ · · · ○');
    expect(placeCells(doc, [0], 1, 1, 2)).toBe(2);
    expect(text(doc)).toBe('D · ○ · · ○');
  });

  it('forward into a pause: the pause does not travel with it', () => {
    const doc = docOf('A B C · · · ·');
    placeCells(doc, [0], 1, 1, 5);
    expect(text(doc)).toBe('A · C · · B ·');
  });

  it('carried on past a neighbour, the neighbour goes back where it stood', () => {
    const doc = docOf('A B C D');
    placeCells(doc, [0], 0, 1, 2);
    expect(text(doc)).toBe('C B A D');
  });

  it('two frames side by side swap at the first step', () => {
    const doc = docOf('A B C ·');
    expect(placeCells(doc, [0], 0, 1, 1)).toBe(1);
    expect(text(doc)).toBe('B A C ·');
  });

  it('back onto a drawing: the two swap places', () => {
    const doc = docOf('A B C');
    placeCells(doc, [0], 2, 1, 0);
    expect(text(doc)).toBe('C B A');
  });

  it('a layer left opening on a continuation opens on an empty drawing', () => {
    const doc = docOf('A · · B');
    placeCells(doc, [0], 0, 1, 2);
    expect(text(doc)).toBe('○ · A B');
    // A block a tick on is rotated: it overlaps its own place.
    const block = docOf('A B C ·');
    placeCells(block, [0], 0, 2, 1);
    expect(text(block)).toBe('C A B ·');
  });

  it('let go where it was, nothing changes', () => {
    const doc = docOf('A · · B');
    const before = doc.layers[0].frames.slice();
    expect(placeCells(doc, [0], 0, 1, 0)).toBe(0);
    expect(doc.layers[0].frames.every((cell, i) => cell === before[i])).toBe(true);
  });

  it('a block keeps its shape and the other layers stand', () => {
    const doc = docOf('A B · · · ·', 'F · · · · ·');
    placeCells(doc, [0], 0, 2, 3);
    expect(text(doc, 0)).toBe('○ · · A B ·');
    expect(text(doc, 1)).toBe('F · · · · ·');
  });

  it('a column: every layer\'s drawing of the tick goes, a layer with only a continuation there stands', () => {
    const doc = docOf('A B C · ·', 'F · · G ·');
    placeCells(doc, [0, 1], 1, 1, 4);
    expect(text(doc, 0)).toBe('A · C · B');
    expect(text(doc, 1)).toBe('F · · G ·');
  });

  it('a copy goes where it is let go too, the original stays', () => {
    const doc = docOf('A · B');
    expect(placeCells(doc, [0], 1, 1, 3, true)).toBe(3);
    expect(text(doc)).toBe('A · B A');
    const two = docOf('A B · ·');
    placeCells(two, [0], 0, 1, 1, true);
    expect(text(two)).toBe('A A B ·');
  });
});
