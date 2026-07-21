import { describe, expect, it } from 'bun:test';
import type { ToonDocumentV2, ToolDescriptor } from './types';
import { validateDocument } from './validate';

function validV2(): ToonDocumentV2 {
  return {
    schema_version: 2,
    width: 4800,
    height: 2400,
    frame_rate: 12,
    tools: [
      { kind: 'pencil', dialect: 'multator', width: 32, color: '#123456' },
      { kind: 'eraser', dialect: 'toonio', width: 40 },
    ],
    frames: [{ strokes: [{ points: [10, 20, 30, 40], tool_id: 0 }] }],
  };
}

describe('format v2 schema and semantics', () => {
  it('accepts pencil and eraser descriptors referenced by tool_id', () => {
    expect(validateDocument(validV2())).toEqual({ ok: true, issues: [] });
  });

  it('rejects an unknown dialect at its descriptor path', () => {
    const doc = structuredClone(validV2()) as unknown as { tools: Array<Record<string, unknown>> };
    doc.tools[0].dialect = 'future';
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.path === '/tools/0/dialect')).toBe(true);
  });

  it('rejects fields forbidden by descriptor kind', () => {
    const eraserWithColor = structuredClone(validV2()) as unknown as { tools: Array<Record<string, unknown>> };
    eraserWithColor.tools[1].color = '#ffffff';
    expect(validateDocument(eraserWithColor).ok).toBe(false);

    const pencilWithoutColor = structuredClone(validV2()) as unknown as { tools: Array<Record<string, unknown>> };
    delete pencilWithoutColor.tools[0].color;
    expect(validateDocument(pencilWithoutColor).ok).toBe(false);
  });

  it('rejects a nonexistent tool_id semantically at the reference path', () => {
    const doc = structuredClone(validV2());
    doc.frames[0].strokes[0].tool_id = 99;
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({
      category: 'semantic',
      path: '/frames/0/strokes/0/tool_id',
      message: 'tool_id 99 does not reference an existing tool',
    });
  });
});

// Compile-time contract: descriptors exposed by the format are immutable.
function immutableTypeContract(descriptor: ToolDescriptor): void {
  // @ts-expect-error descriptors must be replaced/interned, never mutated in place
  descriptor.width = 80;
}
void immutableTypeContract;
