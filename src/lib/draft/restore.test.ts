import { describe, expect, it } from 'bun:test';
import { decideRestore } from './restore';
import { createDocument } from '../model/operations';

describe('decideRestore', () => {
  it('restores a valid draft when the user has not edited yet', () => {
    const doc = createDocument();
    expect(decideRestore(doc, false)?.schema_version).toBe(3);
  });

  it('discards the draft if the user already started editing', () => {
    expect(decideRestore(createDocument(), true)).toBeNull();
  });

  it('discards a draft that fails format validation', () => {
    expect(decideRestore({ schema_version: 1, frames: [] }, false)).toBeNull();
    expect(decideRestore({ nonsense: true }, false)).toBeNull();
    expect(decideRestore({ schema_version: 999, width: 1, height: 1, frame_rate: 12, frames: [{ strokes: [] }] }, false)).toBeNull();
  });

  it('migrates a legacy white-eraser stroke in a restored draft', () => {
    const draft = {
      schema_version: 1,
      width: 4800,
      height: 2400,
      frame_rate: 12,
      frames: [{ strokes: [{ points: [10, 20, 30, 40], width: 32, color: '#ffffff' }] }],
    };
    const restored = decideRestore(draft, false);
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
    const restored = decideRestore(draft, false);
    expect(restored?.schema_version).toBe(3);
    expect(restored?.tools).toEqual(draft.tools as never);
    expect(restored?.layers).toEqual([{ hidden: false, frames: draft.frames }] as never);
  });

  it('returns null when there is no saved draft', () => {
    expect(decideRestore(null, false)).toBeNull();
    expect(decideRestore(undefined, false)).toBeNull();
  });
});
