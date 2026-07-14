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

  it('commit yields only integer coordinates within the canvas', () => {
    const b = new StrokeBuilder({ width: 32, color: '#000000' });
    b.addPoint(-15.7, 0.4);
    b.addPoint(200.5, 300.49);
    b.addPoint(W + 99.9, H + 50);
    const stroke = b.commit(W, H);
    expect(stroke.points.every((c) => Number.isInteger(c))).toBe(true);
    for (let i = 0; i < stroke.points.length; i += 2) {
      expect(stroke.points[i]).toBeGreaterThanOrEqual(0);
      expect(stroke.points[i]).toBeLessThanOrEqual(W);
      expect(stroke.points[i + 1]).toBeGreaterThanOrEqual(0);
      expect(stroke.points[i + 1]).toBeLessThanOrEqual(H);
    }
    // The model accepts the result (double-checks the invariant).
    const doc = createDocument();
    expect(() => addStroke(doc, 0, stroke)).not.toThrow();
  });

  it('commit is deterministic and preserves the first/last points', () => {
    const b1 = new StrokeBuilder({ width: 32, color: '#000000' });
    const b2 = new StrokeBuilder({ width: 32, color: '#000000' });
    drawWobblyLine(b1);
    drawWobblyLine(b2);
    const s1 = b1.commit(W, H);
    const s2 = b2.commit(W, H);
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
    const stroke = b.commit(W, H);
    expect(stroke.points.length).toBeLessThan(b.rawPoints.length);
  });

  it('a single tap commits as a dot', () => {
    const b = new StrokeBuilder({ width: 80, color: '#ff0000' });
    b.addPoint(100.4, 200.6);
    expect(b.commit(W, H)).toEqual({ points: [100, 201], width: 80, color: '#ff0000' });
  });

  it('brush attributes are fixed at stroke start', () => {
    const brush = { width: 32, color: '#AB12CD' };
    const b = new StrokeBuilder(brush);
    brush.width = 160; // "the user switched brushes" mid-stroke
    brush.color = '#000000';
    b.addPoint(10, 10);
    const stroke = b.commit(W, H);
    expect(stroke.width).toBe(32);
    expect(stroke.color).toBe('#ab12cd'); // and normalized to lowercase
  });

  it('committing an empty stroke is an error', () => {
    const b = new StrokeBuilder({ width: 32, color: '#000000' });
    expect(() => b.commit(W, H)).toThrow();
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
      addStroke(doc, 0, b.commit(W, H));
    });
    expect(doc.frames[0].strokes.map((s) => [s.width, s.color])).toEqual([
      [16, '#111111'],
      [48, '#22aa22'],
      [160, '#3333ff'],
    ]);
  });
});
