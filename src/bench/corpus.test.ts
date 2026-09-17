import { describe, expect, it } from 'bun:test';
import { validateDocument } from '../lib/format/validate';
import { buildCorpus } from './corpus';

describe('buildCorpus', () => {
  it('builds N frames × M strokes of a format-valid document', () => {
    const doc = buildCorpus({ frames: 8, strokesPerFrame: 5, pointsPerStroke: 32 });
    expect(doc.layers[0].frames.length).toBe(8);
    for (const frame of doc.layers[0].frames) {
      expect(frame.strokes.length).toBe(5);
    }
    // Built through the real model path, so it must pass the same validator.
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('strokes retain points (not collapsed to a straight line by Lang)', () => {
    const doc = buildCorpus({ frames: 1, strokesPerFrame: 1, pointsPerStroke: 64 });
    expect(doc.layers[0].frames[0].strokes[0].points.length).toBeGreaterThan(4);
  });
});

it('builds a valid mixed Multator/Tonio benchmark corpus', () => {
  const doc = buildCorpus({ frames: 2, strokesPerFrame: 4, pointsPerStroke: 16, mixedEvery: 2 });
  expect(validateDocument(doc).ok).toBe(true);
  const dialects = doc.layers[0].frames.flatMap((frame) => frame.strokes.map((stroke) => doc.tools[stroke.tool_id].dialect));
  expect(dialects).toContain('multator');
  expect(dialects).toContain('toonio');
});

describe('layered corpus', () => {
  it('builds exactly L layers of N frames, every cell with M strokes', () => {
    const doc = buildCorpus({ layers: 5, frames: 4, strokesPerFrame: 3, pointsPerStroke: 32 });
    expect(doc.layers).toHaveLength(5);
    for (const layer of doc.layers) {
      expect(layer.frames).toHaveLength(4);
      for (const cell of layer.frames) {
        expect(cell.strokes).toHaveLength(3);
      }
    }
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('defaults to the documented single-layer Multator profile', () => {
    expect(buildCorpus({ frames: 2, strokesPerFrame: 1, pointsPerStroke: 16 }).layers).toHaveLength(1);
  });
});
