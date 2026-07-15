import { describe, expect, it } from 'bun:test';
import { decideRestore } from './restore';
import { createDocument } from '../model/operations';

describe('decideRestore', () => {
  it('restores a valid draft when the user has not edited yet', () => {
    const doc = createDocument();
    expect(decideRestore(doc, false)).toEqual(doc);
  });

  it('discards the draft if the user already started editing', () => {
    expect(decideRestore(createDocument(), true)).toBeNull();
  });

  it('discards a draft that fails format validation', () => {
    expect(decideRestore({ schema_version: 1, frames: [] }, false)).toBeNull();
    expect(decideRestore({ nonsense: true }, false)).toBeNull();
    expect(decideRestore({ schema_version: 999, width: 1, height: 1, frame_rate: 12, frames: [{ strokes: [] }] }, false)).toBeNull();
  });

  it('returns null when there is no saved draft', () => {
    expect(decideRestore(null, false)).toBeNull();
    expect(decideRestore(undefined, false)).toBeNull();
  });
});
