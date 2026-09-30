import { describe, expect, it } from 'bun:test';
import { FIXED_POINT_SCALE, MAX_BRUSH_SIZE_LOGICAL, MAX_STROKE_WIDTH } from '../format/constants';
import schema from '../format/schema/toon-v7.schema.json';
import { validateDocument } from '../format/validate';
import { scaleToolWidth } from '../model/operations';
import { storedStrokeWidth } from '../tools/profiles';
import { brushCeiling, TOONOP_UX } from './ux-profile';

// Owner, after the fifteenth audit: «убрать ограничение» — Multator's 640 is
// an honest 640 px, not the format's old 600 (4800 units).
const decode = await Bun.file(new URL('../format/toon-decode.ts', import.meta.url)).text();
const widest = MAX_BRUSH_SIZE_LOGICAL * FIXED_POINT_SCALE;

describe('the format holds the widest brush any preset may set', () => {
  it('Multator ends at 640, and 640 px is stored as 640 px', () => {
    expect(brushCeiling({ ...TOONOP_UX, brushSizeMax: 640 })).toBe(640);
    expect(MAX_STROKE_WIDTH).toBeGreaterThanOrEqual(widest);
    expect(storedStrokeWidth(640 * FIXED_POINT_SCALE)).toBe(640 * FIXED_POINT_SCALE);
    expect(scaleToolWidth({ kind: 'pencil', geometry: 'smooth', width: 320 * 8, color: '#000000' }, 2))
      .toMatchObject({ width: 640 * 8 });
  });

  it('every width in the schema takes the same ceiling as the model', () => {
    const widths = Object.values(schema.$defs as Record<string, { properties?: { width?: { maximum: number } } }>)
      .flatMap((def) => (def.properties?.width ? [def.properties.width.maximum] : []));
    expect(widths.length).toBe(4);
    for (const max of widths) expect(max).toBe(MAX_STROKE_WIDTH);
  });

  it('a document with a 640 px line validates — the api reads the same schema', () => {
    const doc = {
      schema_version: 7, width: 10240, height: 5760, frame_rate: 12,
      tools: [{ kind: 'pencil', geometry: 'smooth', width: widest, color: '#000000' }],
      layers: [{ hidden: false, frames: [{ strokes: [{ points: [10, 20, 30, 40], tool_id: 0 }] }] }],
    };
    expect(validateDocument(doc)).toEqual({ ok: true, issues: [] });
  });

  it('the toonio import clamps by the format constant, not a copy of it', () => {
    expect(decode).not.toContain('4800');
    expect(decode).toContain('MAX_STROKE_WIDTH');
  });
});
