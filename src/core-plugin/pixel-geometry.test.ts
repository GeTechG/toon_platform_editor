import { describe, expect, it } from 'bun:test';
import { appendPixelCells, pixelPrepare } from './pixel-geometry';

describe('appendPixelCells', () => {
  // The rule returns what the batch adds to the line, not the line rebuilt.
  it('snaps every point to the grid of the tool width', () => {
    // Reference: w * ~~(x / w) — truncation towards zero, not floor.
    expect(appendPixelCells([], [17, 3, 31.9, -1], 16)).toEqual([16, 0, 16, 0]);
  });

  it('drops a cell the line already holds', () => {
    expect(appendPixelCells([16, 0], [17, 3, 40, 40], 16)).toEqual([32, 32]);
  });

  it('keeps a repeat inside one batch — the reference scans the old points only', () => {
    expect(appendPixelCells([], [0, 0, 1, 1], 16)).toEqual([0, 0, 0, 0]);
  });

  it('adds nothing for an odd coordinate count', () => {
    expect(appendPixelCells([16, 0], [1, 2, 3], 16)).toEqual([]);
  });
});

describe('pixelPrepare', () => {
  it('drops cells closer than the tool width and keeps the true endpoint once', () => {
    // Reference Pixel.Prepare: threshold is the width, and the tail is not
    // duplicated — unlike the pencil's sentinel.
    expect(pixelPrepare([0, 0, 8, 0, 64, 0, 96, 0], 16)).toEqual([0, 0, 64, 0, 96, 0]);
  });

  it('returns a single cell untouched', () => {
    expect(pixelPrepare([16, 16], 16)).toEqual([16, 16]);
  });

  it('divides the threshold by the viewport zoom, so a zoomed stroke keeps more cells', () => {
    // Reference d.w / scale: at zoom 4 the threshold is 4, and the cell at 8
    // that zoom 1 drops survives.
    expect(pixelPrepare([0, 0, 8, 0, 64, 0, 96, 0], 16, 4)).toEqual([0, 0, 8, 0, 64, 0, 96, 0]);
  });

  it('zoom 1 is the threshold the tool width already gave', () => {
    expect(pixelPrepare([0, 0, 8, 0, 64, 0, 96, 0], 16, 1)).toEqual(pixelPrepare([0, 0, 8, 0, 64, 0, 96, 0], 16));
  });
});

