import { describe, expect, it } from 'bun:test';
import { createDocument, addStroke } from '../model/operations';
import { StrokeBuilder, brushWidthDoc } from './stroke-builder';

const W = 4800;
const H = 2400;

function drawWobblyLine(builder: StrokeBuilder): void {
  for (let i = 0; i <= 80; i++) {
    builder.addPoint(i * 50 + 0.3, 1000 + Math.sin(i / 5) * 200 + 0.7);
  }
}

describe('brushWidthDoc', () => {
  it('converts the logical brush size to integer document units', () => {
    expect(brushWidthDoc(4)).toBe(32);
    expect(brushWidthDoc(20)).toBe(160);
    expect(brushWidthDoc(0.01)).toBe(1); // minimum 1
  });
});

describe('StrokeBuilder', () => {
  it('drops consecutive duplicate raw points', () => {
    const b = new StrokeBuilder({ width: 32, color: '#000000' });
    b.addPoint(1.5, 2.5);
    b.addPoint(1.5, 2.5);
    b.addPoint(3, 4);
    b.addPoint(1.5, 2.5); // not consecutive — kept
    expect(b.rawPoints).toEqual([1.5, 2.5, 3, 4, 1.5, 2.5]);
  });

  it('commit yields integer coordinates and keeps off-canvas points unclamped', () => {
    const b = new StrokeBuilder({ width: 32, color: '#000000' });
    b.addPoint(-15.7, 0.4);
    b.addPoint(200.5, 4000.49);
    b.addPoint(W + 99.9, H + 50);
    const stroke = b.commit();
    expect(stroke.points.every((c) => Number.isInteger(c))).toBe(true);
    // Off-canvas points survive: the stroke can leave the canvas.
    expect(stroke.points.slice(0, 2)).toEqual([-16, 0]);
    expect(stroke.points.slice(-2)).toEqual([W + 100, H + 50]);
    // The model accepts the result (double-checks the invariant).
    const doc = createDocument();
    expect(() => addStroke(doc, 0, stroke)).not.toThrow();
  });

  it('commit clamps only to the int16 storage range', () => {
    const b = new StrokeBuilder({ width: 32, color: '#000000' });
    b.addPoint(-100000, 0);
    b.addPoint(100000, 12345.4);
    expect(b.commit().points).toEqual([-32768, 0, 32767, 12345]);
  });

  it('commit is deterministic and preserves the first/last points', () => {
    const b1 = new StrokeBuilder({ width: 32, color: '#000000' });
    const b2 = new StrokeBuilder({ width: 32, color: '#000000' });
    drawWobblyLine(b1);
    drawWobblyLine(b2);
    const s1 = b1.commit();
    const s2 = b2.commit();
    expect(s1).toEqual(s2);
    expect(s1.points.slice(0, 2)).toEqual([Math.round(0.3), Math.round(1000.7)]);
    expect(s1.points.slice(-2)).toEqual([
      Math.round(80 * 50 + 0.3),
      Math.round(1000 + Math.sin(80 / 5) * 200 + 0.7),
    ]);
  });

  it('simplification shrinks a dense stroke before commit', () => {
    const b = new StrokeBuilder({ width: 32, color: '#000000' });
    drawWobblyLine(b);
    const stroke = b.commit();
    expect(stroke.points.length).toBeLessThan(b.rawPoints.length);
  });

  it('a single tap commits as a dot', () => {
    const b = new StrokeBuilder({ width: 80, color: '#ff0000' });
    b.addPoint(100.4, 200.6);
    expect(b.commit()).toEqual({ points: [100, 201], width: 80, color: '#ff0000' });
  });

  it('brush attributes are fixed at stroke start', () => {
    const brush = { width: 32, color: '#AB12CD' };
    const b = new StrokeBuilder(brush);
    brush.width = 160; // "the user switched brushes" mid-stroke
    brush.color = '#000000';
    b.addPoint(10, 10);
    const stroke = b.commit();
    expect(stroke.width).toBe(32);
    expect(stroke.color).toBe('#ab12cd'); // and normalized to lowercase
  });

  it('committing an empty stroke is an error', () => {
    const b = new StrokeBuilder({ width: 32, color: '#000000' });
    expect(() => b.commit()).toThrow();
  });

  it('three strokes in a row keep their order and attributes', () => {
    const doc = createDocument();
    const brushes = [
      { width: brushWidthDoc(2), color: '#111111' },
      { width: brushWidthDoc(6), color: '#22aa22' },
      { width: brushWidthDoc(20), color: '#3333ff' },
    ];
    brushes.forEach((brush, i) => {
      const b = new StrokeBuilder(brush);
      b.addPoint(10 + i * 100, 10);
      b.addPoint(50 + i * 100, 400 + i);
      addStroke(doc, 0, b.commit());
    });
    expect(doc.frames[0].strokes.map((s) => [s.width, s.color])).toEqual([
      [16, '#111111'],
      [48, '#22aa22'],
      [160, '#3333ff'],
    ]);
  });
});

describe('oversized stroke truncation', () => {
  it('caps the coordinate count while preserving the actual endpoint', () => {
    const builder = new StrokeBuilder({ width: 8, color: '#000000' });
    // Zigzag that survives Lang simplification (amplitude >> tolerance).
    for (let i = 0; i < 40000; i++) {
      builder.addPoint(i * 0.1, i % 2 === 0 ? 0 : 2400);
    }
    const stroke = builder.commit();
    expect(stroke.points.length).toBeLessThanOrEqual(65536);
    expect(stroke.points.length % 2).toBe(0);
    expect(stroke.points[0]).toBe(0);
    expect(stroke.points[1]).toBe(0);
    // Last raw point: x = 39999 * 0.1 → 4000, y = 2400.
    expect(stroke.points[stroke.points.length - 2]).toBe(4000);
    expect(stroke.points[stroke.points.length - 1]).toBe(2400);
  });
});
