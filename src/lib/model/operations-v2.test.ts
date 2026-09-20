import { describe, expect, it } from 'bun:test';
import type { ToonDocument, ToolDescriptor } from '../format/types';
import * as operations from './operations';

type InternTool = (doc: ToonDocument, descriptor: ToolDescriptor) => number;
const internTool = (operations as unknown as { internTool?: InternTool }).internTool;

function doc(): ToonDocument {
  return {
    schema_version: 6,
    width: 4800,
    height: 2400,
    frame_rate: 12,
    tools: [],
    layers: [{ hidden: false, frames: [{ strokes: [] }] }],
  };
}

describe('internTool', () => {
  it('is part of the v2 document operations API', () => {
    expect(internTool).toBeFunction();
  });

  it('reuses structurally equal descriptors', () => {
    const target = doc();
    const first = internTool!(target, { kind: 'pencil', dialect: 'multator', width: 32, color: '#123456' });
    const second = internTool!(target, { kind: 'pencil', dialect: 'multator', width: 32, color: '#123456' });
    expect([first, second]).toEqual([0, 0]);
    expect(target.tools).toHaveLength(1);
  });

  it('creates a descriptor when any structural attribute changes', () => {
    const target = doc();
    const variants: ToolDescriptor[] = [
      { kind: 'pencil', dialect: 'multator', width: 32, color: '#123456' },
      { kind: 'pencil', dialect: 'toonio', width: 32, color: '#123456' },
      { kind: 'pencil', dialect: 'multator', width: 40, color: '#123456' },
      { kind: 'pencil', dialect: 'multator', width: 32, color: '#654321' },
      { kind: 'eraser', dialect: 'multator', width: 32 },
    ];
    expect(variants.map((descriptor) => internTool!(target, descriptor))).toEqual([0, 1, 2, 3, 4]);
  });

  it('interns contour descriptors (oldschool pen) by kind, dialect and color', () => {
    const target = doc();
    const ids = [
      internTool!(target, { kind: 'contour', dialect: 'multator', color: '#ff0000' }),
      internTool!(target, { kind: 'contour', dialect: 'multator', color: '#ff0000' }),
      internTool!(target, { kind: 'contour', dialect: 'multator', color: '#000000' }),
      internTool!(target, { kind: 'contour-eraser', dialect: 'multator' }),
      internTool!(target, { kind: 'contour-eraser', dialect: 'multator' }),
      internTool!(target, { kind: 'pencil', dialect: 'multator', width: 32, color: '#ff0000' }),
    ];
    expect(ids).toEqual([0, 0, 1, 2, 2, 3]);
    expect(target.tools[0]).toEqual({ kind: 'contour', dialect: 'multator', color: '#ff0000' });
    expect(target.tools[2]).toEqual({ kind: 'contour-eraser', dialect: 'multator' });
  });

  it('keeps a feather\'s dialect — the same tool drawn two ways is two tools', () => {
    // The table is written from the committed descriptor: flattening the
    // dialect here would store a Multator feather as a Tonio one and render
    // the curve the other way round.
    const target = doc();
    const ids = [
      internTool!(target, { kind: 'feather', dialect: 'multator', width: 40, color: '#000000', fill: '#ff0000' }),
      internTool!(target, { kind: 'feather', dialect: 'toonio', width: 40, color: '#000000', fill: '#ff0000' }),
    ];
    expect(ids).toEqual([0, 1]);
    expect(target.tools[0]).toEqual({
      kind: 'feather', dialect: 'multator', width: 40, color: '#000000', fill: '#ff0000',
    });
  });

  it('copies a new descriptor and never mutates an existing one', () => {
    const target = doc();
    const input = { kind: 'pencil', dialect: 'multator', width: 32, color: '#123456' } as const;
    const id = internTool!(target, input);
    const stored = target.tools[id];
    expect(stored).not.toBe(input);

    const changedId = internTool!(target, { ...input, width: 40 });
    expect(target.tools[id]).toEqual(input);
    expect(target.tools[changedId]).toEqual({ ...input, width: 40 });
  });
});

describe('v2 resolved document operations', () => {
  it('addStroke interns a resolved descriptor instead of accepting a raw foreign index', () => {
    const target = doc();
    operations.addStroke(target, 0, 0, {
      points: [1, 2, 3, 4],
      tool: { kind: 'pencil', dialect: 'toonio', width: 40, color: '#123456' },
    });
    expect(target.tools).toEqual([
      { kind: 'pencil', dialect: 'toonio', width: 40, color: '#123456' },
    ]);
    expect(target.layers[0].frames[0].strokes).toEqual([{ points: [1, 2, 3, 4], tool_id: 0 }]);
  });

  it('clone/copy/paste carries resolved descriptors between documents', () => {
    const source = doc();
    operations.addStroke(source, 0, 0, {
      points: [10, 20],
      tool: { kind: 'eraser', dialect: 'multator', width: 64 },
    });
    const copied = operations.cloneColumn(source, 0);

    const target = doc();
    target.tools.push({ kind: 'pencil', dialect: 'multator', width: 8, color: '#000000' });
    operations.replaceColumn(target, 0, copied);

    expect(target.layers[0].frames[0].strokes).toEqual([{ points: [10, 20], tool_id: 1 }]);
    expect(target.tools[1]).toEqual({ kind: 'eraser', dialect: 'multator', width: 64 });
  });

  it('counts v2 points for document limits through resolved strokes', () => {
    const target = doc();
    expect(() => operations.addStroke(target, 0, 0, {
      points: [1, 2, 3],
      tool: { kind: 'eraser', dialect: 'multator', width: 8 },
    })).toThrow(RangeError);
  });
});
