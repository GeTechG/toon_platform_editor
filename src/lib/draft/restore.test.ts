import { describe, expect, it } from 'bun:test';
import { parseDraft } from './restore';
import { createDocument } from '../model/operations';

describe('parseDraft', () => {
  it('parses a valid draft', () => {
    expect(parseDraft(createDocument())?.schema_version).toBe(7);
  });

  it('discards a draft that fails format validation', () => {
    expect(parseDraft({ schema_version: 1, frames: [] })).toBeNull();
    expect(parseDraft({ schema_version: 6, width: 1, height: 1, frame_rate: 12, tools: [], layers: [{ hidden: false, frames: [{ strokes: [] }] }] })).toBeNull();
    expect(parseDraft({ nonsense: true })).toBeNull();
    expect(parseDraft({ schema_version: 999, width: 1, height: 1, frame_rate: 12, frames: [{ strokes: [] }] })).toBeNull();
  });

      it('returns null when the record holds nothing', () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft(undefined)).toBeNull();
  });
});
