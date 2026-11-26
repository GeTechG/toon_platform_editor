import { expect, test } from 'bun:test';
import type { ToonDocument } from '../../src/lib/format/types';
import { readDrawing } from './scene';

test('rejects retraced ink that can wrap an eight-bit stencil', () => {
  const loop = [800, 800, 2400, 800, 2400, 2400, 800, 2400];
  const points = Array.from({ length: 256 }, () => loop).flat().concat(loop.slice(0, 2));
  const doc: ToonDocument = {
    schema_version: 8, width: 3200, height: 3200, frame_rate: 12,
    tools: [{ kind: 'pencil', geometry: 'line', width: 80, color: '#000000' }],
    layers: [{ hidden: false, frames: [{ strokes: [{ tool_id: 0, points }] }] }],
  };
  expect(() => readDrawing(doc, 0)).toThrow(/stencil/);
  doc.layers[0].frames[0]!.strokes[0].points = loop.concat(loop.slice(0, 2));
  expect(readDrawing(doc, 0)).toHaveLength(1);
});
