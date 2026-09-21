import { describe, expect, it } from 'bun:test';
import { draftEntries, parseDraft } from './restore';
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

describe('draftEntries', () => {
  it('parses every stored record, newest order kept', () => {
    const records = [
      { id: 'b', updated: 2, doc: createDocument() },
      { id: 'a', updated: 1, doc: createDocument() },
    ];
    expect(draftEntries(records).map((e) => e.id)).toEqual(['b', 'a']);
    expect(draftEntries(records)[0].doc.schema_version).toBe(7);
  });

  it('carries the session state, the screenshot and the size to the card', () => {
    const screenshot = new Blob(['webp']);
    const state = {
      frame: 3, layer: 1, tool: 'pencil', widths: { pencil: 4 }, smooth: {}, minDistance: {},
      outline: '#000000', fill: '#ff0000', palette: ['#000000'],
    };
    const [entry] = draftEntries([
      { id: 'a', updated: 1, doc: createDocument(), state, screenshot, bytes: 1234 },
    ]);
    expect(entry.state).toEqual(state);
    expect(entry.screenshot).toBe(screenshot);
    expect(entry.bytes).toBe(1234);
  });

  it('drops a record the format cannot load instead of hiding the rest', () => {
    const records = [
      { id: 'broken', updated: 2, doc: { nonsense: true } },
      { id: 'good', updated: 1, doc: createDocument() },
    ];
    expect(draftEntries(records).map((e) => e.id)).toEqual(['good']);
  });
});
