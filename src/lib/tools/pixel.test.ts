import { describe, expect, it } from 'bun:test';
import { appendPixelCells, interpolatePixelLine, pixelPrepare } from './pixel';

describe('appendPixelCells', () => {
  it('snaps every point to the grid of the tool width', () => {
    // Reference: w * ~~(x / w) — truncation towards zero, not floor.
    expect(appendPixelCells([], [17, 3, 31.9, -1], 16)).toEqual([16, 0, 16, 0]);
  });

  it('drops a cell the line already holds', () => {
    expect(appendPixelCells([16, 0], [17, 3, 40, 40], 16)).toEqual([16, 0, 32, 32]);
  });

  it('keeps a repeat inside one batch — the reference scans the old points only', () => {
    expect(appendPixelCells([], [0, 0, 1, 1], 16)).toEqual([0, 0, 0, 0]);
  });

  it('ignores an odd coordinate count', () => {
    expect(appendPixelCells([16, 0], [1, 2, 3], 16)).toEqual([16, 0]);
  });
});

describe('interpolatePixelLine (Bresenham over cells)', () => {
  it('walks an axis-dominant line in whole cells, endpoints included', () => {
    expect(interpolatePixelLine(0, 0, 48, 0, 16)).toEqual([0, 0, 16, 0, 32, 0, 48, 0]);
  });

  it('walks a diagonal one cell at a time', () => {
    expect(interpolatePixelLine(0, 0, 32, 32, 16)).toEqual([0, 0, 16, 16, 32, 32]);
  });

  it('a y-dominant line steps along y', () => {
    expect(interpolatePixelLine(0, 0, 0, 32, 16)).toEqual([0, 0, 0, 16, 0, 32]);
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
});
