import { describe, expect, it } from 'bun:test';
import { LAYER_TAGS, defaultLayerColors, normalizeLayerColors } from './layer-colors';

describe('a layer carries its own tag colour', () => {
  it('a fresh document cycles the six, as the rows always did', () => {
    expect(defaultLayerColors(8)).toEqual([0, 1, 2, 3, 4, 5, 0, 1]);
    expect(LAYER_TAGS).toBe(6);
  });

  it('a restored draft keeps the colours it saved', () => {
    expect(normalizeLayerColors([3, 0, 5], 3)).toEqual([3, 0, 5]);
  });

  it('layers the record does not cover fall back to the cycle', () => {
    expect(normalizeLayerColors([3], 3)).toEqual([3, 1, 2]);
  });

  it('a record longer than the document loses the tail', () => {
    expect(normalizeLayerColors([3, 0, 5], 2)).toEqual([3, 0]);
  });

  it('junk in the record is a default, not a broken swatch', () => {
    expect(normalizeLayerColors(['red', 9, -1, 2.5], 4)).toEqual([0, 1, 2, 3]);
    expect(normalizeLayerColors(undefined, 2)).toEqual([0, 1]);
  });
});
