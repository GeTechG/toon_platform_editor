import { describe, expect, it } from 'bun:test';
import { draftEntries, parseDraft } from './restore';
import { createDocument } from '../model/operations';

describe('parseDraft', () => {
  it('parses a valid draft', () => {
    expect(parseDraft(createDocument())?.schema_version).toBe(5);
  });

  it('discards a draft that fails format validation', () => {
    expect(parseDraft({ schema_version: 1, frames: [] })).toBeNull();
    expect(parseDraft({ nonsense: true })).toBeNull();
    expect(parseDraft({ schema_version: 999, width: 1, height: 1, frame_rate: 12, frames: [{ strokes: [] }] })).toBeNull();
  });

  it('migrates a legacy white-eraser stroke in a restored draft', () => {
    const draft = {
      schema_version: 1,
      width: 4800,
      height: 2400,
      frame_rate: 12,
      frames: [{ strokes: [{ points: [10, 20, 30, 40], width: 32, color: '#ffffff' }] }],
    };
    const restored = parseDraft(draft);
    const stroke = restored?.layers[0].frames[0].strokes[0];
    expect(stroke && restored?.tools[stroke.tool_id]).toEqual({
      kind: 'eraser', dialect: 'multator', width: 32,
    });
  });

  it('migrates a valid v2 draft into one visible layer, tool references intact', () => {
    const draft = {
      schema_version: 2,
      width: 4800,
      height: 2400,
      frame_rate: 12,
      tools: [{ kind: 'pencil', dialect: 'toonio', width: 40, color: '#123456' }],
      frames: [{ strokes: [{ points: [10, 20], tool_id: 0 }] }],
    };
    const restored = parseDraft(draft);
    expect(restored?.schema_version).toBe(5);
    expect(restored?.tools).toEqual(draft.tools as never);
    expect(restored?.layers).toEqual([{ hidden: false, frames: draft.frames }] as never);
  });

  it('returns null when the record holds nothing', () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft(undefined)).toBeNull();
  });
});

describe('draftEntries', () => {
  it('parses every stored record, newest order kept', () => {
    const records = [
      { id: 'b', updated: 2, doc: createDocument() },
      { id: 'a', updated: 1, doc: createDocument() },
    ];
    expect(draftEntries(records).map((e) => e.id)).toEqual(['b', 'a']);
    expect(draftEntries(records)[0].doc.schema_version).toBe(5);
  });

  it('drops a record the format cannot load instead of hiding the rest', () => {
    const records = [
      { id: 'broken', updated: 2, doc: { nonsense: true } },
      { id: 'good', updated: 1, doc: createDocument() },
    ];
    expect(draftEntries(records).map((e) => e.id)).toEqual(['good']);
  });
});
