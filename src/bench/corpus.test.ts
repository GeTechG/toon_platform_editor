import { describe, expect, it } from 'bun:test';
import { validateDocument } from '../lib/format/validate';
import { buildCorpus } from './corpus';

describe('buildCorpus', () => {
  it('builds N frames × M strokes of a format-valid document', () => {
    const doc = buildCorpus({ frames: 8, strokesPerFrame: 5, pointsPerStroke: 32 });
    expect(doc.frames.length).toBe(8);
    for (const frame of doc.frames) {
      expect(frame.strokes.length).toBe(5);
    }
    // Built through the real model path, so it must pass the same validator.
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('strokes retain points (not collapsed to a straight line by Lang)', () => {
    const doc = buildCorpus({ frames: 1, strokesPerFrame: 1, pointsPerStroke: 64 });
    expect(doc.frames[0].strokes[0].points.length).toBeGreaterThan(4);
  });
});
